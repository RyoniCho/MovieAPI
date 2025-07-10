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
        req.userRole = decoded.role; // role 저장
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

function requireAdmin(req, res, next) {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ error: '관리자만 접근 가능합니다.' });
    }
    next();
  }

const downloadContents = async (serialNumber,url)=>{
    console.log("downloadcontents:"+url);
    const response = await axios.get(url.trim(), { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');
    const fileName = serialNumber +"_"+ Date.now()+ path.extname(url);
    const filePath = path.join('uploads', fileName);
    await fs_extra.outputFile(filePath, buffer);

    return filePath;
}
function updateM3U8Paths(m3u8FilePath, baseUrl) {
    try {
      const content = fs.readFileSync(m3u8FilePath, 'utf-8');
      const updatedContent = content.replace(/^(?!#)(.+\.ts)$/gm, `${baseUrl}$1`);
      fs.writeFileSync(m3u8FilePath, updatedContent, 'utf-8');
      console.log(`Updated .m3u8 file with Base URL: ${baseUrl}`);
    } catch (err) {
      console.error(`Failed to update .m3u8 file: ${err.message}`);
    }
  }

async function handleHLSDownload(m3u8Url, outputFilePath) {
    try {

    

      // 1. m3u8 파일 다운로드
      const response = await axios.get(m3u8Url);
      const m3u8Content = response.data;
  
      // 2. m3u8 파일 저장
      const tempM3U8Path = path.join(__dirname, 'temp.m3u8');
      await fs_extra.outputFile(tempM3U8Path, m3u8Content);

      const absoluteOutputPath = path.resolve(__dirname, outputFilePath);

      // Base URL 추출 (m3u8Url에서  .m3u8 앞부분까지 가져옴)
     const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);

     updateM3U8Paths(tempM3U8Path,baseUrl);
  
      // 3. ffmpeg로 MP4 변환
      return new Promise((resolve, reject) => {
        ffmpeg(tempM3U8Path)
          .inputOptions([
            '-protocol_whitelist', 'file,http,https,tcp,tls', // 필요한 프로토콜 허용
          ])
          .outputOptions([
            '-c:v', 'libx264', // 비디오 코덱 설정
            '-c:a', 'aac',     // 오디오 코덱 설정
            '-strict', 'experimental',
            '-hls_base_url', baseUrl, // Base URL 설정
          ])
          .on('start', () => console.log('HLS to MP4 conversion started'))
          .on('end', () => {
            console.log('HLS to MP4 conversion completed');
            fs.unlinkSync(tempM3U8Path); // 임시 m3u8 파일 삭제
            resolve(absoluteOutputPath);
          })
          .on('error', (err) => {
            console.error('Error during conversion:', err);
            reject(err);
          })
          .on('stderr', (stderrLine) => {
            console.log('FFmpeg stderr:', stderrLine);
          })
          .save(absoluteOutputPath); // 최종 MP4 파일 저장 경로
      });
    } catch (err) {
      console.error('Error handling HLS download:', err);
      throw err;
    }
  }
  
function transformSubtituteTrailerUrl(inputUrl, serialNumber) {
  try {
    const url = new URL(inputUrl);

    url.hostname = "media.javtrailers.com";

    const pathParts = url.pathname.split('/');
    pathParts[1] = 'hlsvideo';
    pathParts[2] = 'freepv';

    const originalFileName = pathParts[pathParts.length - 1];

    let finalFileName;

    if (originalFileName.includes('fsd')) {
      finalFileName = originalFileName.replace('.mp4', '.m3u8');
    } else {
      finalFileName = 'playlist.m3u8';
    }

    pathParts[pathParts.length - 1] = finalFileName;

    // 예외 처리
    const exceptionFilePath = path.join(__dirname, 'trailer_except.txt');
    if (fs.existsSync(exceptionFilePath)) {
      const fileContent = fs.readFileSync(exceptionFilePath, 'utf-8');
      const lines = fileContent.split('\n');
      for (const line of lines) {
        const cleanedLine = line.replace(/\r/g, '').trim();
        if (!cleanedLine) continue;
        const [fileSerialNumber, exceptionUrl] = cleanedLine.split(',');
        if (fileSerialNumber.trim() === serialNumber.trim()) {
          return { finalUrl: exceptionUrl.trim(), originalFileName };
        }
      }
    }

    url.pathname = pathParts.join('/');
    return { finalUrl: url.toString(), originalFileName };

  } catch (error) {
    console.error("Invalid URL:", error);
    return null;
  }
}

async function resolveAvailableTrailerUrlFromPlaylist(playlistUrl, originalFileName) {
  const possibleKeys = ['hhb.m3u8', 'hmb.m3u8', 'mmb.m3u8'];

  try {
    const res = await fetch(playlistUrl);
    if (res.ok) {
      const content = await res.text();
      const lines = content.split('\n').map(line => line.trim());

      for (const key of possibleKeys) {
        const foundLine = lines.find(line =>
          line.endsWith('.m3u8') && line.includes(key)
        );
        if (foundLine) {
          const url = new URL(playlistUrl);
          const pathParts = url.pathname.split('/');
          // 전체 파일명을 그대로 넣는다!
          pathParts[pathParts.length - 1] = foundLine;
          url.pathname = pathParts.join('/');
          return url.toString();
        }
      }
    } else {
      console.warn(`playlist.m3u8 fetch failed: ${res.status}`);
    }
  } catch (err) {
    console.error("Error reading playlist.m3u8:", err);
  }

  // fallback: 원본 이름에서 mhb_w 를 hhb로
  const fallbackUrl = new URL(playlistUrl);
  const fallbackParts = fallbackUrl.pathname.split('/');
  const newFileName = originalFileName.replace('_mhb_w.mp4', '_hhb.m3u8');
  fallbackParts[fallbackParts.length - 1] = newFileName;
  fallbackUrl.pathname = fallbackParts.join('/');
  return fallbackUrl.toString();
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
        '-hls_base_url', `hls/${path.basename(videoPath, path.extname(videoPath))}_${resolution}/`
        
      ])
      .output(path.join(hlsPath, 'master.m3u8'))
      .on('start', () => {
        console.log('HLS 트랜스코딩 시작');
      })
      .on('end', () => {
        console.log('HLS 트랜스코딩 완료');
       
        fs.unlinkSync(videoPath);
        console.log(`${videoPath} : file removed`);
    
       
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
app.post('/api/movies',authMiddleware,requireAdmin, upload.fields([{ name: 'image' }, { name: 'trailer' }]), async (req, res) => {
    try{
        const { title, description, serialNumber, actor, plexRegistered,releaseDate,category,urlImage,urlsExtraImage,urlTrailer,mainMoviePath,subscriptExist} = req.body;

        
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

                    try
                    {
                        console.log("Try Download JAV trailer HLS")
                            //OutputFile Path
                        const fileName = serialNumber +"_"+ Date.now()+ ".mp4";
                        const outputFilePath = path.join('uploads', fileName);
                        transformSubtituteTrailerUrl(urlTrailer,serialNumber)


                        const { finalUrl, originalFileName } = transformSubtituteTrailerUrl(urlTrailer, serialNumber);

                        let finalTrailerUrl;
                        if (finalUrl.includes('playlist.m3u8')) {
                            finalTrailerUrl = await resolveAvailableTrailerUrlFromPlaylist(finalUrl, originalFileName);
                        } else {
                            finalTrailerUrl = finalUrl; // 예외 케이스나 FALENO는 그대로 사용
                        }

                        await handleHLSDownload(finalTrailerUrl,outputFilePath);

                        trailerPath= outputFilePath;
                    }
                    catch(err)
                    {
                        res.status(500).json({ error: 'Failed to update movie' });
                        console.log(err)
                    }
                    
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
        
        let mainMovieSubPath = '';
        console.log(`mainMoviePath:${mainMoviePath}`);
        if(mainMoviePath!=='')
        {
           
            mainMovieSubPath = mainMoviePath.replace(".mp4",".vtt");
            if(!fs.existsSync(path.join(__dirname, mainMovieSubPath)))
            {
                mainMovieSubPath='';
                console.log(`not exist: ${path.join(__dirname, mainMovieSubPath)}`);
            }
            else{
                console.log(`subscript added : ${path.join(__dirname, mainMovieSubPath)}`)
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
            mainMovieSub: mainMovieSubPath,
            subscriptExist
            
    
    
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
app.delete('/api/movies/:id',authMiddleware,requireAdmin, async (req, res) => {
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
app.get('/api/movies',authMiddleware, async (req, res) => {
    const { serialNumber, actor, owned, subscriptExist, category, sortOrder, page, pageSize } = req.query;
    const filter = {};

    if (serialNumber) {
        const regex = new RegExp(serialNumber, 'i'); // 대소문자 구분 없이 품번 검색
        filter.serialNumber = regex;
    }
    if (actor) {
        filter.actor = actor;
    }
    if (owned) {
       
        if(owned==="false")
        {
            filter.plexRegistered = false;
            // mainMovie 필드가 존재하지 않거나 빈 값인 경우
            filter.mainMovie = { $in: [null, ""] };
        }
        else
        {
          
            if (owned === "plex") {
               
                filter.plexRegistered = true;
            }

            if (owned === "web") {
                // mainMovie 필드가 존재하고 빈 값이 아닌 경우
                filter.mainMovie = { $exists: true, $ne: "" };
            } 
        }

    }
   
    if (subscriptExist) {

        if(subscriptExist !== "all")
        {
            filter.subscriptExist = subscriptExist === 'true';
        }
    }
    if (category) {
        filter.category = category;
    }

    console.log(`page: ${page}`);

    console.log(filter)
    

    try {
        const sort = sortOrder === 'asc' ? { releaseDate: 1 } : { releaseDate: -1 };
        const movies = await Movie.find(filter)
                                .sort(sort)
                                .skip((page - 1) * pageSize)
                                .limit(parseInt(pageSize));
                             
        res.json(movies);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch movies' });
        console.log(err);
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
app.post('/api/actors', authMiddleware,requireAdmin,async (req, res) => {
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
app.put('/api/movies/:id',authMiddleware,requireAdmin, async (req, res) => {
    try {
        const movieId = req.params.id;
        const updatedData = req.body;

        //자막정보 반영
        let mainMovieSubPath = '';
       
        if(updatedData.mainMovie!=='')
        {
           
            mainMovieSubPath = updatedData.mainMovie.replace(".mp4",".vtt");
            if(!fs.existsSync(path.join(__dirname, mainMovieSubPath)))
            {
                mainMovieSubPath='';
                console.log(`not exist: ${path.join(__dirname, mainMovieSubPath)}`);
            }
            else{
                console.log(`subscript added : ${path.join(__dirname, mainMovieSubPath)}`)
                updatedData.mainMovieSub = mainMovieSubPath;
            }
        }

        

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