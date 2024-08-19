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

const downloadImage = async (serialNumber,url)=>{
    const response = await axios.get(url.trim(), { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');
    const fileName = serialNumber +"_"+ Date.now()+ path.extname(url);
    const filePath = path.join('uploads', fileName);
    await fs_extra.outputFile(filePath, buffer);

    return filePath;
}

// 라우팅 설정
app.post('/api/movies',authMiddleware, upload.fields([{ name: 'image' }, { name: 'trailer' },{ name: 'extraImages', maxCount: 10 }]), async (req, res) => {
    try{
        const { title, description, serialNumber, actor, plexRegistered,releaseDate,category,urlImage} = req.body;

        //const image = (urlImage!=='') ? downloadImage(serialNumber,urlImage): req.files.image[0].path;
        let imagePath;
        if (urlImage && urlImage !== '') {
            imagePath = await downloadImage(serialNumber, urlImage); // 비동기 처리
        } else if (req.files.image && req.files.image.length > 0) {
            imagePath = req.files.image[0].path;
        } else {
            throw new Error('Image file or URL is required.');
        }

        const trailerPath = req.files.trailer[0].path;
        //const extraImages = req.files.extraImage.map(file => file.path);
    
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
            //extraImage,
    
    
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

// 서버 시작
app.listen(3001, () => {
  console.log('Server is running on port 3001');
});