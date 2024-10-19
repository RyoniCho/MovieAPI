const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const Movie = require('./models/Movie');
const Actor = require('./models/Actor');
const cors = require('cors'); // CORS 패키지 추가
const fs = require('fs');
const authRoutes = require('./Auth');
const axios = require('axios');
const fs_extra = require('fs-extra');
const ffmpeg = require('fluent-ffmpeg');

const jwt = require('jsonwebtoken');
const { isFloat32Array } = require('util/types');

const app = express();

require('dotenv').config();
const JWT_SECRET = process.env.JWT_SECRET;
const CORS_ORIGIN= process.env.CORS_ORIGIN;

// MongoDB 연결
mongoose.connect('mongodb://localhost:27017/movies', { useNewUrlParser: true, useUnifiedTopology: true });

// Multer 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {

    const ext = path.extname(file.originalname);
    const fileName = req.body.serialNumber +"_"+ Date.now()+ ext; // serialNumber로 파일명 설정
    cb(null, fileName);
  },
});

const upload = multer({ storage });


app.use(cors(
    {
    origin: [CORS_ORIGIN,"http://localhost:3000"],
    credentials: true,
}
)); // CORS 미들웨어 추가





// 미들웨어 설정
app.use(express.json());
app.use('/uploads', express.static('uploads'));// 업로드된 파일을 정적으로 제공

//Login Auth
app.use('/api/auth', authRoutes);

//JWT 확인하는 미들웨어
const authMiddleware = (req, res, next) => {

    const authorization = req.header('Authorization');
    console.log("authMiddleware: "+authorization);

    const token = authorization.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

const downloadContents = async (serialNumber,url)=>{
    console.log("downloadcontents:"+url);
    const response = await axios.get(url.trim(), { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');
    const fileName = serialNumber +"_"+ Date.now()+ path.extname(url);
    const filePath = path.join('uploads', fileName);
    await fs_extra.outputFile(filePath, buffer);

    return filePath;
}

app.use('/api/hls', express.static(path.join(__dirname, 'hls')));

app.get('/api/stream', (req, res) => {
    const videoPath = req.query.file;
    const resolution = req.query.resolution;
    
    const hlsPath = path.join(__dirname, 'hls', `${path.basename(videoPath, path.extname(videoPath))}_${resolution}`);
    
    // hlsPath 폴더가 없으면 생성
    fs_extra.ensureDirSync(hlsPath);

    // 이미 HLS 파일이 생성된 경우, 해당 파일을 제공
    if (fs.existsSync(path.join(hlsPath, 'master.m3u8'))) {
      return res.sendFile(path.join(hlsPath, 'master.m3u8'));
    } 

    console.log("ffmpeg start");
  
    // HLS 파일을 실시간으로 생성
    ffmpeg(videoPath)
      .outputOptions([
        '-vf', `scale=-1:${resolution === '720p' ? 720 : 1080}`,
        '-c:v', 'libx264',
        '-crf', '20',
        '-preset', 'veryfast',
        '-hls_time', '10', // 10초 간격으로 분할
        '-hls_playlist_type', 'event',
        '-hls_segment_filename', path.join(hlsPath, 'segment_%03d.ts'),
        '-hls_base_url', `hls/${path.basename(videoPath, path.extname(videoPath))}_${resolution}`
        
      ])
      .output(path.join(hlsPath, 'master.m3u8'))
      .on('start', () => {
        console.log('HLS 트랜스코딩 시작');
      })
      .on('end', () => {
        console.log('HLS 트랜스코딩 완료');
    
       
      })
      .on('stderr', (stderr) => {
        console.log('stderr 로그:', stderr);
      })
      .on('error', (err) => {
        console.error('HLS 트랜스코딩 오류:', err);
        if (!res.headersSent) {
          res.status(500).send('HLS 트랜스코딩 중 오류 발생');
        }
      })
      .run();

      res.sendFile(path.join(hlsPath, 'master.m3u8'));
  });

// 라우팅 설정
app.post('/api/movies',authMiddleware, upload.fields([{ name: 'image' }, { name: 'trailer' }]), async (req, res) => {
    try{
        const { title, description, serialNumber, actor, plexRegistered,releaseDate,category,urlImage,urlsExtraImage,urlTrailer,mainMoviePath} = req.body;

        
        let imagePath;
        if (urlImage && urlImage !== '') {
            imagePath = await downloadContents(serialNumber, urlImage); // 비동기 처리
        } else if (req.files.image && req.files.image.length > 0) {
            imagePath = req.files.image[0].path;
        } else {
            throw new Error('Image file or URL is required.');
        }

        let trailerPath;
       
        if(urlTrailer && urlTrailer!=='')
        {
            try{
                trailerPath= await downloadContents(serialNumber,urlTrailer);
            }
            catch
            {
                try
                {
                    
                    trailerPath= await downloadContents(serialNumber,urlTrailer.replace("_mhb_w","_dm_w"));
                }
                catch(err)
                {
                    res.status(500).json({ error: 'Failed to update movie' });
                    console.log(err)
                }
               
            }
          

        }
        else if(req.files.trailer && req.files.trailer.length>0)
        {
            trailerPath=req.files.trailer[0].path;
        }
        else {
            throw new Error('Trailer file or URL is required.');
        }

        let extraImagePaths =[];
        
        
        if(urlsExtraImage && urlsExtraImage.length>0)
        {
            const listUrlExtraImg= urlsExtraImage.split(',');

            for(let i =0; i<listUrlExtraImg.length;i++)
            {
                let path = await downloadContents(serialNumber,listUrlExtraImg[i])
                extraImagePaths.push(path);
            }
        }
        
       
    
        const movie = new Movie(
        { 
            title, 
            description,
            serialNumber,
            actor,
            plexRegistered: plexRegistered === 'true',// boolean으로 변환
            image: imagePath,
            trailer: trailerPath,
            releaseDate,
            category,
            extraImage:extraImagePaths,
            mainMovie : mainMoviePath,
    
    
        });
        await movie.save();
    
        res.status(201).send(movie);
    }
    catch(err)
    {
        console.log(err)
    }
  
});

// 영화 삭제 API
app.delete('/api/movies/:id',authMiddleware, async (req, res) => {
    try {
        const movie = await Movie.findByIdAndDelete(req.params.id);
        if (!movie) {
            return res.status(404).json({ error: 'Movie not found' });
        }
        // 로컬 파일 
        if(fs.existsSync(path.join(__dirname, movie.image)))
        {
            fs.unlinkSync(path.join(__dirname, movie.image));
        }
        else
        {
            console.log("not exist: "+ path.join(__dirname,movie.image));
        }

        if(fs.existsSync(path.join(__dirname,  movie.trailer)))
        {
            fs.unlinkSync(path.join(__dirname,movie.trailer));
        }
        else
        {
            console.log("not exist: "+ path.join(__dirname, movie.trailer));
        }

        for(let i=0; i<movie.extraImage.length;i++)
        {
            let extraImagePath = path.join(__dirname,  movie.extraImage[i]);
            if(fs.existsSync(extraImagePath))
            {
                fs.unlinkSync(extraImagePath);
            }
            else
            {
                console.log("not exist: "+ extraImagePath);
            }
        }
       
       

        res.json({ message: 'Movie deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete movie' });
        console.log(err)
    }
});


// 모든 영화 정보를 가져오는 API
app.get('/api/movies', async (req, res) => {
    const { serialNumber } = req.query;

    try {
        let movies;
        if (serialNumber) {
            const regex = new RegExp(serialNumber, 'i'); // 대소문자 구분 없이 품번 검색
            movies = await Movie.find({ serialNumber: regex });
        } else {
            movies = await Movie.find(); // 모든 영화 정보를 MongoDB에서 가져옴
        }
        res.json(movies);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch movies' });
        console.log(err)
    }
});

// 특정 ID의 영화 정보를 가져오는 API
app.get('/api/movies/:id', async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id); // ID로 특정 영화 찾기
        if (!movie) {
            return res.status(404).json({ error: 'Movie not found' });
        }
        res.json(movie);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch movie' });
        console.log(err)
    }
});

// 모든 배우 가져오기
app.get('/api/actors', async (req, res) => {
    try {
        const actors = await Actor.find();
        res.json(actors);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch actors' });
        console.log(err)
    }
});

// 새로운 배우 추가
app.post('/api/actors', authMiddleware,async (req, res) => {
    const { name } = req.body;

    const actor = new Actor({ name });

    try {
        await actor.save();
        res.status(201).json(actor);
    } catch (err) {
        res.status(500).json({ error: 'Failed to add actor' });
        console.log(err)
    }
});

// 영화정보 업데이트
app.put('/api/movies/:id',authMiddleware, async (req, res) => {
    try {
        const movieId = req.params.id;
        const updatedData = req.body;

        // 영화 정보 업데이트
        const updatedMovie = await Movie.findByIdAndUpdate(movieId, updatedData, { new: true });

        if (!updatedMovie) {
            return res.status(404).json({ message: 'Movie not found' });
        }

        res.json(updatedMovie);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update movie' });
        console.log(err)
    }
});

const updateMoviesWithExtraImages = async () => {
    try {
        // `extraImage` 필드가 없는 영화들만 필터링
        const movies = await Movie.find({ extraImage: { $exists: false } });
        
        for (const movie of movies) {
            const splitedSerialNumber= movie.serialNumber.trim().split("-");
            const revisedSerialNumber= `${splitedSerialNumber[0].toLowerCase()}00${splitedSerialNumber[1]}`;
            let extraImagePaths=[];
            for(let i=1; i<=10;i++)
            {
                const url = `https://pics.dmm.co.jp/digital/video/${revisedSerialNumber}/${revisedSerialNumber}jp-${i}.jpg`
                const imagePath = await downloadContents(movie.serialNumber, url);
                extraImagePaths.push(imagePath);
            }
            movie.extraImage = extraImagePaths;
            await movie.save();
        }

        console.log('Movies updated with extra images successfully.');
    } catch (err) {
        console.error('Error updating movies:', err);
    }
};

//updateMoviesWithExtraImages();

// 서버 시작
app.listen(3001, () => {
  console.log('Server is running on port 3001');
});