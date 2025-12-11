const express = require('express');
const router = express.Router();
const Movie = require('../models/Movie');
const UserActionLog = require('../models/UserActionLog');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { downloadContents, transformSubtituteTrailerUrl, resolveAvailableTrailerUrlFromPlaylist } = require('../utils/downloader');
const { handleHLSDownload } = require('../utils/ffmpeg');
const fs = require('fs');
const path = require('path');

// 영화 등록 API
const cpUpload = upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'trailer', maxCount: 1 },
    { name: 'extraImage', maxCount: 10 }
]);

router.post('/', authMiddleware, requireAdmin, cpUpload, async (req, res) => {
    try {
        const { title, description, serialNumber, actor, releaseDate, category, urlImage, urlTrailer, urlsExtraImage, subscriptExist, plexRegistered, isSeries, episodes } = req.body;
        
        let mainMovieObj = {};
        try {
            mainMovieObj = typeof req.body.mainMovie === 'string' ? JSON.parse(req.body.mainMovie) : req.body.mainMovie;
        } catch {
            mainMovieObj = {};
        }

        let episodesArr = [];
        if (isSeries === 'true' || isSeries === true) {
            try {
                episodesArr = typeof episodes === 'string' ? JSON.parse(episodes) : episodes;
                // Auto-detect subtitles for episodes
                const checkOrder = ['1080p', '720p', '4k', '2160p'];
                for (let ep of episodesArr) {
                    if (!ep.sub) {
                        for (const q of checkOrder) {
                            if (ep.video && ep.video[q]) {
                                const ext = path.extname(ep.video[q]);
                                const vttPath = ep.video[q].replace(ext, '.vtt');
                                if (fs.existsSync(path.join(__dirname, '..', vttPath))) {
                                    ep.sub = vttPath;
                                    break;
                                }
                            }
                        }
                    }
                }
            } catch {
                episodesArr = [];
            }
        }

        let imagePath;
        if (urlImage && urlImage !== '') {
            imagePath = await downloadContents(serialNumber, urlImage);
        } else if (req.files.image && req.files.image.length > 0) {
            imagePath = req.files.image[0].path;
        }

        let trailerPath;
        const defaultDummyTrailerPath = `uploads/SSNI-289_1723546895296.mp4`;
        let trailerDownloadFailed = false;

        if (urlTrailer && urlTrailer !== '') {
            try {
                trailerPath = await downloadContents(serialNumber, urlTrailer);
            } catch {
                try {
                    trailerPath = await downloadContents(serialNumber, urlTrailer.replace("_mhb_w", "_dm_w"));
                } catch (err) {
                    try {
                        console.log("Try Download JAV trailer HLS");
                        const fileName = serialNumber + "_" + Date.now() + ".mp4";
                        const outputFilePath = path.join('uploads', fileName);
                        
                        const { finalUrl, originalFileName } = transformSubtituteTrailerUrl(urlTrailer, serialNumber);

                        let finalTrailerUrl;
                        if (finalUrl && finalUrl.includes('playlist.m3u8')) {
                            finalTrailerUrl = await resolveAvailableTrailerUrlFromPlaylist(finalUrl, originalFileName);
                        } else {
                            finalTrailerUrl = finalUrl;
                        }

                        if (finalTrailerUrl && finalTrailerUrl.endsWith('.mp4')) {
                            trailerPath = await downloadContents(serialNumber, finalTrailerUrl);
                        } else if (finalTrailerUrl) {
                            await handleHLSDownload(finalTrailerUrl, outputFilePath);
                            trailerPath = outputFilePath;
                        } else {
                            trailerDownloadFailed = true;
                        }
                    } catch (err) {
                        console.log("Trailer download failed, using dummy trailer.");
                        trailerDownloadFailed = true;
                    }
                }
            }
        } else if (req.files.trailer && req.files.trailer.length > 0) {
            trailerPath = req.files.trailer[0].path;
        } else {
            trailerDownloadFailed = true;
        }

        if (trailerDownloadFailed || !trailerPath) {
            trailerPath = defaultDummyTrailerPath;
        }

        let extraImagePaths =[];
        if(urlsExtraImage && urlsExtraImage.length>0) {
            const listUrlExtraImg= urlsExtraImage.split(',');
            for(let i =0; i<listUrlExtraImg.length;i++) {
                let path = await downloadContents(serialNumber,listUrlExtraImg[i])
                extraImagePaths.push(path);
            }
        } else if (req.files.extraImage && req.files.extraImage.length > 0) {
            for(let i=0;i<req.files.extraImage.length;i++) {
                extraImagePaths.push( req.files.extraImage[i].path);
            }
        } else {
            console.log("No extra images provided.");
        } 
        
        let mainMovieSubPath = '';
        const checkOrder = ['1080p', '720p', '4k', '2160p'];
        for (const q of checkOrder) {
            if (mainMovieObj[q]) {
                const vttPath = mainMovieObj[q].replace('.mp4', '.vtt');
                if (fs.existsSync(path.join(__dirname, '..', vttPath))) {
                    mainMovieSubPath = vttPath;
                    break;
                }
            }
        }
        
        const movie = new Movie({ 
            title, 
            description,
            serialNumber,
            actor,
            plexRegistered: plexRegistered === 'true',
            image: imagePath,
            trailer: trailerPath,
            releaseDate,
            category,
            extraImage:extraImagePaths,
            mainMovie : mainMovieObj,
            mainMovieSub: mainMovieSubPath,
            subscriptExist,
            isSeries: isSeries === 'true' || isSeries === true,
            episodes: episodesArr
        });
        await movie.save();
    
        res.status(201).send(movie);
    } catch(err) {
        console.log(err)
        res.status(500).json({ error: 'Failed to add movie' });
    }
});

// 영화 삭제 API
router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const movie = await Movie.findByIdAndDelete(req.params.id);
        if (!movie) {
            return res.status(404).json({ error: 'Movie not found' });
        }
        
        const rootDir = path.join(__dirname, '..');

        if(fs.existsSync(path.join(rootDir, movie.image))) {
            fs.unlinkSync(path.join(rootDir, movie.image));
        }

        if(fs.existsSync(path.join(rootDir, movie.trailer))) {
            fs.unlinkSync(path.join(rootDir, movie.trailer));
        }

        for(let i=0; i<movie.extraImage.length;i++) {
            let extraImagePath = path.join(rootDir, movie.extraImage[i]);
            if(fs.existsSync(extraImagePath)) {
                fs.unlinkSync(extraImagePath);
            }
        }

        res.json({ message: 'Movie deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete movie' });
        console.log(err)
    }
});

// 모든 영화 정보를 가져오는 API
router.get('/', authMiddleware, async (req, res) => {
    const { serialNumber, actor, owned, subscriptExist, category, sortOrder, page, pageSize } = req.query;
    const filter = {};

    if (serialNumber) {
        const regex = new RegExp(serialNumber, 'i');
        filter.serialNumber = regex;
    }
    if (actor) {
        filter.actor = actor;
    }
    if (owned) {
        if (owned === "false") {
            filter.plexRegistered = false;
            filter.$or = [
                { mainMovie: { $exists: false } },
                { mainMovie: null },
                { $expr: {
                    $eq: [
                        {
                            $size: {
                                $filter: {
                                    input: { $objectToArray: "$mainMovie" },
                                    as: "mm",
                                    cond: { $or: [
                                        { $eq: [ { $ifNull: ["$$mm.v", null] }, null ] },
                                        { $eq: [ { $ifNull: ["$$mm.v", ""] }, "" ] },
                                        { $eq: [ { $ifNull: ["$$mm.v", false] }, false ] }
                                    ] }
                                }
                            }
                        },
                        { $size: { $objectToArray: "$mainMovie" } }
                    ]
                } }
            ];
        } else {
            if (owned === "plex") {
                filter.plexRegistered = true;
            }
            if (owned === "web") {
                filter.$and = filter.$and || [];
                filter.$and.push({ mainMovie: { $exists: true } });
                filter.$and.push({ $expr: { $gt: [ { $size: { $objectToArray: "$mainMovie" } }, 0 ] } });
            }
            if (owned === "web4k") {
                filter.$and = filter.$and || [];
                filter.$and.push({ mainMovie: { $exists: true } });
                filter.$and.push({
                    $expr: {
                        $gt: [
                            {
                                $size: {
                                    $filter: {
                                        input: { $objectToArray: "$mainMovie" },
                                        as: "mm",
                                        cond: {
                                            $and: [
                                                { $in: [ { $toLower: "$$mm.k" }, ["4k", "2160p"] ] },
                                                { $ne: [ { $ifNull: ["$$mm.v", ""] }, "" ] }
                                            ]
                                        }
                                    }
                                }
                            },
                            0
                        ]
                    }
                });
            }
            if (owned === "web1080p") {
                filter.$and = filter.$and || [];
                filter.$and.push({ mainMovie: { $exists: true } });
                filter.$and.push({
                    $expr: {
                        $gt: [
                            {
                                $size: {
                                    $filter: {
                                        input: { $objectToArray: "$mainMovie" },
                                        as: "mm",
                                        cond: {
                                            $and: [
                                                { $eq: [ { $toLower: "$$mm.k" }, "1080p" ] },
                                                { $ne: [ { $ifNull: ["$$mm.v", ""] }, "" ] }
                                            ]
                                        }
                                    }
                                }
                            },
                            0
                        ]
                    }
                });
            }
        }
    }
   
    if (subscriptExist) {
        if(subscriptExist !== "all") {
            filter.subscriptExist = subscriptExist === 'true';
        }
    }
    if (category) {
        filter.category = category;
    } else {
        filter.category = { $ne: 'AdultVideo' };
    }

    try {
        let sort = { releaseDate: -1 };
        if (sortOrder === 'asc') {
            sort = { releaseDate: 1 };
        } else if (sortOrder === 'createdAsc') {
            sort = { _id: 1 };
        } else if (sortOrder === 'createdDesc') {
            sort = { _id: -1 };
        }
        const totalCount = await Movie.countDocuments(filter);
        const movies = await Movie.find(filter)
            .sort(sort)
            .skip((page - 1) * pageSize)
            .limit(parseInt(pageSize));
        res.json({ movies, totalCount });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch movies' });
        console.log(err);
    }
});

// 특정 ID의 영화 정보를 가져오는 API
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id);
        if (!movie) {
            return res.status(404).json({ error: 'Movie not found' });
        }
        res.json(movie);

        const log = new UserActionLog({ 
            userId: req.userId,
            action: 'view',
            targetId: movie._id,
            details: `Viewed movie: ${movie.serialNumber}(${movie.actor}) ${movie.title}`,
        });
        await log.save();
        console.log(`User ${req.userId} viewed movie: ${movie.title}`);

    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch movie' });
        console.log(err)
    }
});

// 영화정보 업데이트
const putUpload = upload.fields([
    { name: 'image' },
    { name: 'trailer' },
    { name: 'extraImage' }
]);
router.put('/:id', authMiddleware, requireAdmin, putUpload, async (req, res) => {
    try {
        const movieId = req.params.id;
        const body = req.body;
        let mainMovieObj = {};
        try {
            mainMovieObj = typeof body.mainMovie === 'string' ? JSON.parse(body.mainMovie) : body.mainMovie;
        } catch {
            mainMovieObj = {};
        }

        let episodesArr = [];
        if (body.isSeries === 'true' || body.isSeries === true) {
            try {
                episodesArr = typeof body.episodes === 'string' ? JSON.parse(body.episodes) : body.episodes;
                const checkOrder = ['1080p', '720p', '4k', '2160p'];
                for (let ep of episodesArr) {
                    if (!ep.sub) {
                        for (const q of checkOrder) {
                            if (ep.video && ep.video[q]) {
                                const ext = path.extname(ep.video[q]);
                                const vttPath = ep.video[q].replace(ext, '.vtt');
                                if (fs.existsSync(path.join(__dirname, '..', vttPath))) {
                                    ep.sub = vttPath;
                                    break;
                                }
                            }
                        }
                    }
                }
            } catch {
                episodesArr = [];
            }
        }

        let imagePath;
        if (body.urlImage && body.urlImage !== '') {
            imagePath = await downloadContents(body.serialNumber, body.urlImage);
        } else if (req.files.image && req.files.image.length > 0) {
            imagePath = req.files.image[0].path;
        }

        let extraImagePaths = [];
        if (body.urlsExtraImage && body.urlsExtraImage.length > 0) {
            const listUrlExtraImg = body.urlsExtraImage.split(',');
            for (let i = 0; i < listUrlExtraImg.length; i++) {
                let path = await downloadContents(body.serialNumber, listUrlExtraImg[i]);
                extraImagePaths.push(path);
            }
        }
        if (req.files.extraImage && req.files.extraImage.length > 0) {
            for (let i = 0; i < req.files.extraImage.length; i++) {
                extraImagePaths.push(req.files.extraImage[i].path);
            }
        }

        let mainMovieSubPath = '';
        const checkOrder = ['1080p', '720p', '4k', '2160p'];
        for (const q of checkOrder) {
            if (mainMovieObj[q]) {
                const vttPath = mainMovieObj[q].replace('.mp4', '.vtt');
                if (fs.existsSync(path.join(__dirname, '..', vttPath))) {
                    mainMovieSubPath = vttPath;
                    break;
                }
            }
        }

        const updateFields = {
            title: body.title,
            description: body.description,
            actor: body.actor,
            serialNumber: body.serialNumber,
            subscriptExist: body.subscriptExist === 'true' || body.subscriptExist === true,
            plexRegistered: body.plexRegistered === 'true' || body.plexRegistered === true,
            releaseDate: body.releaseDate,
            category: body.category,
            mainMovie: mainMovieObj,
            mainMovieSub: mainMovieSubPath,
            trailer: body.trailer,
            isSeries: body.isSeries === 'true' || body.isSeries === true,
            episodes: episodesArr
        };
        if (imagePath) updateFields.image = imagePath;
        if (extraImagePaths.length > 0) updateFields.extraImage = extraImagePaths;

        const updatedMovie = await Movie.findByIdAndUpdate(movieId, updateFields, { new: true });
        if (!updatedMovie) {
            return res.status(404).json({ message: 'Movie not found' });
        }
        res.json(updatedMovie);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update movie' });
        console.log(err);
    }
});

module.exports = router;