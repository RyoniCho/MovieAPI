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
const User = require('./models/User');
const UserActionLog = require('./models/UserActionLog');
const WatchHistory = require('./models/WatchHistory');
const Favorite = require('./models/Favorite');
const jwt = require('jsonwebtoken');
const { isFloat32Array } = require('util/types');
const { exec, spawn } = require('child_process');


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
        // 랜덤값 추가 (예: 6자리 hex)
        const randomStr = Math.random().toString(16).slice(2, 8);
        const fileName = req.body.serialNumber + "_" + Date.now() + "_" + randomStr + ext;
        cb(null, fileName);
    },
});

const upload = multer({ storage });


app.use(cors(
    {
    origin: [CORS_ORIGIN,"http://localhost:3000", "http://192.168.0.109:3000"],
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

    let token = req.header('Authorization');
    
    // 헤더에 없으면 쿼리 파라미터 확인 (다운로드 링크 등에서 사용)
    if (!token && req.query.token) {
        token = req.query.token;
    } else if (token) {
        token = token.replace('Bearer ', '');
    }

    // console.log("authMiddleware: " + (token ? "Token exists" : "No token"));

    if (!token) {
       console.log(`[AUTH ERROR] Missing Authorization header or token query`);
        console.log(`[API] ${req.method} ${req.originalUrl}`);
        // console.trace('authMiddleware stack trace');
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


// 유저별 영화 시청 위치 조회 API
app.get('/api/watch-history', authMiddleware, async (req, res) => {
    const userId = req.userId;
    const { movieId, episodeIndex } = req.query;
    if (!movieId) {
        return res.status(400).json({ error: 'movieId is required' });
    }
    
    const epIdx = episodeIndex !== undefined ? parseInt(episodeIndex) : -1;

    try {
        // 하위 호환성: episodeIndex가 -1인 경우, 필드가 없거나 -1인 문서를 찾음
        let query = { userId, movieId };
        if (epIdx === -1) {
            query.$or = [{ episodeIndex: -1 }, { episodeIndex: { $exists: false } }];
        } else {
            query.episodeIndex = epIdx;
        }

        const history = await WatchHistory.findOne(query);
        if (history) {
            res.json({ lastWatchedTime: history.lastWatchedTime });
        } else {
            res.json({ lastWatchedTime: 0 }); // 기록 없으면 0초
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch watch history' });
        console.log(err);
    }
});

// 유저별 영화 시청 위치 저장/업데이트 API
app.post('/api/watch-history', authMiddleware, async (req, res) => {
    const userId = req.userId;
    const { movieId, lastWatchedTime, episodeIndex } = req.body;
    if (!movieId || typeof lastWatchedTime !== 'number') {
        return res.status(400).json({ error: 'movieId와 lastWatchedTime(Number)가 필요합니다.' });
    }

    const epIdx = episodeIndex !== undefined ? parseInt(episodeIndex) : -1;

    try {
        // 업데이트 시에는 명확하게 episodeIndex를 지정하여 저장
        // 기존 데이터 마이그레이션을 위해, 만약 epIdx가 -1이고 기존에 필드 없는 데이터가 있다면 업데이트
        let filter = { userId, movieId, episodeIndex: epIdx };
        
        // (선택적) 기존 데이터 마이그레이션 로직을 여기에 넣을 수도 있지만, 
        // 단순하게 upsert로 처리하면 새로운 포맷으로 저장됨.
        // 다만, 기존 기록(필드 없음)을 이어받으려면 먼저 찾아보고 업데이트하는게 좋음.
        if (epIdx === -1) {
             const existing = await WatchHistory.findOne({ userId, movieId, episodeIndex: { $exists: false } });
             if (existing) {
                 existing.episodeIndex = -1;
                 existing.lastWatchedTime = lastWatchedTime;
                 existing.updatedAt = Date.now();
                 await existing.save();
                 return res.json({ success: true, lastWatchedTime: existing.lastWatchedTime });
             }
        }

        const updated = await WatchHistory.findOneAndUpdate(
            { userId, movieId, episodeIndex: epIdx },
            { lastWatchedTime, updatedAt: Date.now() },
            { upsert: true, new: true }
        );
        res.json({ success: true, lastWatchedTime: updated.lastWatchedTime });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save watch history' });
        console.log(err);
    }
});
    



function requireAdmin(req, res, next) {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ error: '관리자만 접근 가능합니다.' });
    }
    next();
  }

const downloadContents = async (serialNumber, url) => {
    console.log("downloadcontents:" + url);
    // 이미 서버 파일이면 그대로 반환
    if (typeof url === 'string' && (url.startsWith('uploads/') || url.startsWith('uploads\\'))) {
        return url.replace(/\\/g, '/'); // 윈도우 경로도 /로 통일
    }
    const response = await axios.get(url.trim(), { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');
    const fileName = serialNumber + "_" + Date.now() + path.extname(url);
    const filePath = path.join('uploads', fileName);
    await fs_extra.outputFile(filePath, buffer);
    return filePath.replace(/\\/g, '/');
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
  const possibleKeys = ['hhb', 'hmb', 'mmb', 'mhb', 'dmb', 'dm', 'sm'];

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
          pathParts[pathParts.length - 1] = foundLine; // 라인 전체를 파일명으로
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

  // fallback: 원본에서 '_mhb_w.mp4' → '_hhb.m3u8'
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

        let scaleValue = 1080;
        if (resolution === '720p') scaleValue = 720;
        else if (resolution === '4k' || resolution === '2160p') scaleValue = 2160;

        // 하드웨어 인코더 감지: 퀵싱크 > 비디오툴박스 > libx264
        // 1. 환경변수로 강제 지정 가능 (예: process.env.PREFERRED_ENCODER)
        // 2. macOS면 h264_videotoolbox, 아니면 h264_qsv, 둘 다 안되면 libx264
        let encoder = 'libx264';
        const isMac = process.platform === 'darwin';
        if (process.env.PREFERRED_ENCODER) {
            encoder = process.env.PREFERRED_ENCODER;
        } else {
            // macOS: h264_videotoolbox 우선
            if (isMac) {
                encoder = 'h264_videotoolbox';
            } else {
                // Intel Quick Sync (h264_qsv) 우선
                encoder = 'h264_qsv';
            }
        }

        // HLS 파일을 실시간으로 생성
        const vttPath = videoPath.replace(path.extname(videoPath), '.vtt');
        const hasSubtitle = fs.existsSync(vttPath);

        // Windows 경로 호환성을 위해 역슬래시를 슬래시로 변환
        const cleanPath = (p) => p.replace(/\\/g, '/');

        // fluent-ffmpeg 대신 spawn을 사용하여 인자 전달 문제 해결
        const args = [
            '-i', cleanPath(videoPath)
        ];

        if (hasSubtitle) {
            args.push('-i', cleanPath(vttPath));
        }

        args.push(
            '-vf', `scale=-1:${scaleValue}`,
            '-c:v', encoder,
            '-hls_time', '10',
            '-hls_playlist_type', 'event',
            '-hls_base_url', `hls/${path.basename(videoPath, path.extname(videoPath))}_${resolution}/`
        );

        // 인코더별 품질 제어 옵션 분기 처리
        if (encoder === 'libx264') {
            args.push('-crf', '20');
            args.push('-preset', 'veryfast');
        } else if (encoder === 'h264_qsv') {
             // QSV는 -crf를 지원하지 않음. -global_quality (ICQ) 사용
             args.push('-global_quality', '20'); 
             args.push('-preset', 'veryfast');
        } else if (encoder === 'h264_videotoolbox') {
             // macOS VideoToolbox는 -q:v (0-100) 사용
             args.push('-q:v', '60'); 
        } else {
            // 그 외 인코더(혹은 fallback)는 기본 비트레이트나 crf 시도
            args.push('-crf', '20');
            args.push('-preset', 'veryfast');
        }

        if (hasSubtitle) {
            args.push(
                '-map', '0:v',
                '-map', '0:a?',
                '-map', '1:s',
                '-var_stream_map', 'v:0,a:0,sgroup:subs s:0,sgroup:subs',
                '-hls_segment_filename', cleanPath(path.join(hlsPath, 'segment_%v_%03d')),
                '-master_pl_name', 'master.m3u8',
                cleanPath(path.join(hlsPath, 'playlist_%v.m3u8'))
            );
        } else {
            args.push(
                '-hls_segment_filename', cleanPath(path.join(hlsPath, 'segment_%03d.ts')),
                cleanPath(path.join(hlsPath, 'master.m3u8'))
            );
        }

        console.log('HLS 트랜스코딩 시작 (encoder: ' + encoder + ')');
        // console.log('FFmpeg Args:', args); // 디버깅 필요시 주석 해제
        if (hasSubtitle) console.log('자막 포함 트랜스코딩 - AirPlay 싱크 보정 모니터링 시작');

        const ffmpegProcess = spawn('ffmpeg', args);

        if (hasSubtitle) {
            monitorAndFixSubtitles(hlsPath, ffmpegProcess);
        }

        ffmpegProcess.stderr.on('data', (data) => {
            console.log('stderr 로그:', data.toString());
        });

        ffmpegProcess.on('error', (err) => {
            console.error('HLS 트랜스코딩 오류:', err);
            if (!res.headersSent) {
                res.status(500).send('HLS 트랜스코딩 중 오류 발생');
            }
        });

        ffmpegProcess.on('exit', (code) => {
            if (code === 0) {
                console.log('HLS 트랜스코딩 완료');
                try {
                    if (fs.existsSync(videoPath)) {
                        fs.unlinkSync(videoPath);
                        console.log(`${videoPath} : file removed`);
                    }
                } catch (e) {
                    console.error('파일 삭제 중 오류:', e);
                }
            } else {
                console.error(`HLS 트랜스코딩 실패 (Exit Code: ${code})`);
            }
        });
        
        res.sendFile(path.join(hlsPath, 'master.m3u8'));

        // hasSubtitle일 경우 master.m3u8이 생성되기를 기다려야 할 수도 있지만,
        // ffmpeg가 파일을 생성하는 시점과 res.sendFile 시점의 차이 주의.
        // 기존 로직도 비동기 run() 후 바로 sendFile을 호출함.
        // ffmpeg가 초기 파일을 생성할 때까지 약간의 지연이 있을 수 있음.
        // 하지만 기존 코드가 작동했다면, 여기서도 비슷하게 작동할 것임.
        // 단, hasSubtitle일 경우 master.m3u8은 -master_pl_name 옵션으로 생성됨.
        
        res.sendFile(path.join(hlsPath, 'master.m3u8'));
  });

// HLS를 MP4로 변환하여 다운로드 제공하는 API
app.get('/api/download', authMiddleware, (req, res) => {
    const videoPath = req.query.file;
    const resolution = req.query.resolution || '1080p'; // 기본값

    if (!videoPath) {
        return res.status(400).send('File path is required');
    }

    // HLS 폴더 경로 구성 (api/stream과 동일한 로직)
    const filenameBase = path.basename(videoPath, path.extname(videoPath));
    const hlsPath = path.join(__dirname, 'hls', `${filenameBase}_${resolution}`);
    const m3u8Path = path.join(hlsPath, 'master.m3u8');
    console.log("Download requested for: " + m3u8Path);

    // HLS 파일이 존재하는지 확인
    if (!fs.existsSync(m3u8Path)) {
        return res.status(404).send('File not found. Please play the video first to generate HLS.');
    }

    // ffmpeg가 로컬 파일을 읽을 때 m3u8 내부의 경로가 'hls/...' 로 되어있으면
    // m3u8 파일 위치 기준 상대 경로로 인식하여 파일을 찾지 못하는 문제가 발생함.
    // 따라서 다운로드용 임시 m3u8 파일을 생성하여 경로를 파일명만 남기도록 수정함.
    const tempM3u8Path = path.join(hlsPath, 'download.m3u8');
    try {
        let m3u8Content = fs.readFileSync(m3u8Path, 'utf8');
        // "hls/폴더명/" 패턴을 제거하여 파일명만 남김
        const prefixToRemove = `hls/${filenameBase}_${resolution}/`;
        // 정규식으로 모든 발생 패턴 제거
        const regex = new RegExp(prefixToRemove.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        m3u8Content = m3u8Content.replace(regex, '');
        
        // EVENT 타입을 VOD로 변경 (다운로드 최적화: ffmpeg가 스트림 끝을 명확히 인지하도록 함)
        m3u8Content = m3u8Content.replace('#EXT-X-PLAYLIST-TYPE:EVENT', '#EXT-X-PLAYLIST-TYPE:VOD');
        
        fs.writeFileSync(tempM3u8Path, m3u8Content, 'utf8');
    } catch (err) {
        console.error('Error creating temp m3u8:', err);
        return res.status(500).send('Error preparing download');
    }

    const downloadFilename = `${filenameBase}.mp4`;

    // 다운로드 헤더 설정
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadFilename)}"`);
    res.setHeader('Content-Type', 'video/mp4');

    console.log(`Starting download (Remuxing) for: ${downloadFilename}`);

    // ffmpeg를 사용하여 m3u8을 mp4로 Remuxing (재인코딩 X, 단순 합치기) 하여 Pipe로 전송
    ffmpeg(tempM3u8Path)
        .inputOptions([
            '-allowed_extensions', 'ALL',
            '-protocol_whitelist', 'file,http,https,tcp,tls',
            '-analyzeduration', '20000000', // 20초 (분석 시간 제한)
            '-probesize', '20000000'        // 20MB (분석 데이터 크기 제한)
        ])
        .outputOptions([
            '-c', 'copy',              // 비디오/오디오 코덱 복사 (매우 빠름)
            '-bsf:a', 'aac_adtstoasc', // TS -> MP4 변환 시 오디오 필터 필수
            '-movflags', 'frag_keyframe+empty_moov' // 스트리밍 전송을 위한 Fragmented MP4 설정
        ])
        .format('mp4')
        .on('error', (err) => {
            console.error('Download error:', err);
            // 스트림이 이미 시작되었을 수 있으므로 헤더 체크
            if (!res.headersSent) {
                res.status(500).send('Error during download');
            } else {
                res.end(); 
            }
            // 에러 발생 시에도 임시 파일 삭제 시도 (EBUSY 방지를 위해 약간의 지연 후 삭제)
            setTimeout(() => {
                if (fs.existsSync(tempM3u8Path)) {
                    try {
                        fs.unlinkSync(tempM3u8Path);
                    } catch (e) {
                        console.error('Failed to delete temp m3u8 on error:', e.message);
                    }
                }
            }, 1000);
        })
        .on('end', () => {
            console.log(`Download completed: ${downloadFilename}`);
            // 완료 후 임시 파일 삭제 (EBUSY 방지를 위해 약간의 지연 후 삭제)
            setTimeout(() => {
                if (fs.existsSync(tempM3u8Path)) {
                    try {
                        fs.unlinkSync(tempM3u8Path);
                    } catch (e) {
                        console.error('Failed to delete temp m3u8 on end:', e.message);
                    }
                }
            }, 1000);
        })
        .pipe(res, { end: true });
});

// 라우팅 설정
app.post('/api/movies',authMiddleware,requireAdmin, upload.fields([{ name: 'image' }, { name: 'trailer' },{name:'extraImage'}]), async (req, res) => {
    try{
        const { title, description, serialNumber, actor, plexRegistered,releaseDate,category,urlImage,urlsExtraImage,urlTrailer,mainMovie,subscriptExist, isSeries, episodes} = req.body;

        let mainMovieObj ={};
        try{
            mainMovieObj= JSON.parse(mainMovie);
        }
        catch(err)
        {
            mainMovieObj={};
        }

        let episodesArr = [];
        if (isSeries === 'true' || isSeries === true) {
            try {
                episodesArr = JSON.parse(episodes);
                // Auto-detect subtitles for episodes
                const checkOrder = ['1080p', '720p', '4k', '2160p'];
                for (let ep of episodesArr) {
                    // If sub is not explicitly provided, try to find it
                    if (!ep.sub) {
                        for (const q of checkOrder) {
                            if (ep.video && ep.video[q]) {
                                // Replace extension with .vtt
                                const ext = path.extname(ep.video[q]);
                                const vttPath = ep.video[q].replace(ext, '.vtt');
                                if (fs.existsSync(path.join(__dirname, vttPath))) {
                                    ep.sub = vttPath;
                                    break;
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                episodesArr = [];
            }
        }
        
        let imagePath;
        if (urlImage && urlImage !== '') {
            imagePath = await downloadContents(serialNumber, urlImage); // 비동기 처리
        } else if (req.files.image && req.files.image.length > 0) {
            imagePath = req.files.image[0].path;
        } else {
            throw new Error('Image file or URL is required.');
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
                        //OutputFile Path
                        const fileName = serialNumber + "_" + Date.now() + ".mp4";
                        const outputFilePath = path.join('uploads', fileName);
                        transformSubtituteTrailerUrl(urlTrailer, serialNumber);

                        const { finalUrl, originalFileName } = transformSubtituteTrailerUrl(urlTrailer, serialNumber);

                        let finalTrailerUrl;
                        if (finalUrl && finalUrl.includes('playlist.m3u8')) {
                            finalTrailerUrl = await resolveAvailableTrailerUrlFromPlaylist(finalUrl, originalFileName);
                        } else {
                            finalTrailerUrl = finalUrl; // 예외 케이스나 FALENO는 그대로 사용
                        }

                        if (finalTrailerUrl && finalTrailerUrl.endsWith('.mp4')) {
                            // mp4면 바로 다운로드
                            trailerPath = await downloadContents(serialNumber, finalTrailerUrl);
                        } else if (finalTrailerUrl) {
                            // m3u8이면 HLS 처리
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
        
        
        if(urlsExtraImage && urlsExtraImage.length>0)
        {
            const listUrlExtraImg= urlsExtraImage.split(',');

            for(let i =0; i<listUrlExtraImg.length;i++)
            {
                let path = await downloadContents(serialNumber,listUrlExtraImg[i])
                extraImagePaths.push(path);
            }
        }
        else if (req.files.extraImage && req.files.extraImage.length > 0) {
            for(let i=0;i<req.files.extraImage.length;i++)
            {
                extraImagePaths.push( req.files.extraImage[i].path);
            }
           
        }
        else{
            console.log("No extra images provided.");
        } 
        
        let mainMovieSubPath = '';
       
        const checkOrder = ['1080p', '720p', '4k', '2160p'];
        for (const q of checkOrder) 
        {
            if (mainMovieObj[q]) 
            {
                const vttPath = mainMovieObj[q].replace('.mp4', '.vtt');
                if (fs.existsSync(path.join(__dirname, vttPath))) {
                mainMovieSubPath = vttPath;
                break;
                }
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
            mainMovie : mainMovieObj,
            mainMovieSub: mainMovieSubPath,
            subscriptExist,
            isSeries: isSeries === 'true' || isSeries === true,
            episodes: episodesArr
            
    
    
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
            fs.unlinkSync(path.join(__dirname, movie.trailer));
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
        if (owned === "false") {
            filter.plexRegistered = false;
            // mainMovie 필드가 존재하지 않거나, 모든 값이 빈 문자열/false/null인 경우
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
                // 4k 또는 2160p 키가 mainMovie에 존재하고, 값이 빈 문자열이 아닌 경우만
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
                // 1080p 키가 mainMovie에 존재하고, 값이 빈 문자열이 아닌 경우만
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
        let sort = { releaseDate: -1 };
        if (sortOrder === 'asc') {
            sort = { releaseDate: 1 };
        } else if (sortOrder === 'createdAsc') {
            sort = { _id: 1 };
        } else if (sortOrder === 'createdDesc') {
            sort = { _id: -1 };
        }
        // 전체 개수 (필터 적용)
        const totalCount = await Movie.countDocuments(filter);
        // 페이징된 데이터
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
app.get('/api/movies/:id',authMiddleware, async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id); // ID로 특정 영화 찾기
        if (!movie) {
            return res.status(404).json({ error: 'Movie not found' });
        }
        res.json(movie);

        //userActionLog에 조회 기록 저장
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

// 모든 배우 가져오기
app.get('/api/actors', async (req, res) => {
    try {
        const actors = await Actor.find();
        // 한글/영어 분리
        const isKorean = (name) => /[\u3131-\u318E\uAC00-\uD7A3]/.test(name);
        const koreanActors = actors.filter(a => isKorean(a.name)).sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));
        const englishActors = actors.filter(a => !isKorean(a.name)).sort((a, b) => a.name.localeCompare(b.name, 'en'));
        res.json([...koreanActors, ...englishActors]);
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
const putUpload = upload.fields([
    { name: 'image' },
    { name: 'trailer' },
    { name: 'extraImage' }
]);
app.put('/api/movies/:id', authMiddleware, requireAdmin, putUpload, async (req, res) => {
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
                // Auto-detect subtitles for episodes
                const checkOrder = ['1080p', '720p', '4k', '2160p'];
                for (let ep of episodesArr) {
                    if (!ep.sub) {
                        for (const q of checkOrder) {
                            if (ep.video && ep.video[q]) {
                                const ext = path.extname(ep.video[q]);
                                const vttPath = ep.video[q].replace(ext, '.vtt');
                                if (fs.existsSync(path.join(__dirname, vttPath))) {
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

        // 대표 이미지 처리
        let imagePath;
        if (body.urlImage && body.urlImage !== '') {
            imagePath = await downloadContents(body.serialNumber, body.urlImage);
        } else if (req.files.image && req.files.image.length > 0) {
            imagePath = req.files.image[0].path;
        }

        // 추가 이미지 처리
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

        // 자막정보 반영
        let mainMovieSubPath = '';
        const checkOrder = ['1080p', '720p', '4k', '2160p'];
        for (const q of checkOrder) {
            if (mainMovieObj[q]) {
                const vttPath = mainMovieObj[q].replace('.mp4', '.vtt');
                if (fs.existsSync(path.join(__dirname, vttPath))) {
                    mainMovieSubPath = vttPath;
                    break;
                }
            }
        }

        // 업데이트 데이터 구성
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

// 관리자만 접근 가능
app.post('/api/users', authMiddleware, requireAdmin, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
        return res.status(400).json({ error: 'username, password, role 필요' });
    }
    try {
        const user = new User({ username, password, role });
        await user.save();
        res.status(201).json({ success: true, user });
    } catch (err) {
        console.error('유저 생성 실패:', err);
        res.status(500).json({ error: '유저 생성 실패', details: err.message });
    }
});

// 로그 저장 API
app.post('/api/user-action-log', authMiddleware, async (req, res) => {
    const { action, targetId, details } = req.body;
    try {
        const log = new UserActionLog({
            userId: req.userId,
            action,
            targetId,
            details
        });
        await log.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: '로그 저장 실패', details: err.message });
    }
});

// 로그인/조회/재생 로그 전체 조회 (관리자만)
app.get('/api/admin/user-action-logs', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const logs = await UserActionLog.find({})
            .populate('userId', 'username')
            .sort({ timestamp: -1 })
            .limit(200); // 최근 200개만
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: '로그 조회 실패', details: err.message });
    }
});

// 영화별 재생 위치(WatchHistory) 전체 조회 (관리자만)
app.get('/api/admin/watch-histories', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const histories = await WatchHistory.find({})
            .populate('userId', 'username')
            .populate('movieId', 'title serialNumber')
            .sort({ updatedAt: -1 })
            .limit(200);
        res.json(histories);
    } catch (err) {
        res.status(500).json({ error: '시청 기록 조회 실패', details: err.message });
    }
});

// 내 최근 시청 기록 조회 (로그인 유저)
app.get('/api/users/me/watch-histories', authMiddleware, async (req, res) => {
    try {
        const histories = await WatchHistory.find({ userId: req.userId })
            .populate('movieId')
            .sort({ updatedAt: -1 })
            .limit(50);
        res.json(histories);
    } catch (err) {
        res.status(500).json({ error: '내 시청 기록 조회 실패', details: err.message });
    }
});

// 내 시청 기록 개별 삭제 (로그인 유저)
app.delete('/api/users/me/watch-histories/:id', authMiddleware, async (req, res) => {
    try {
        const history = await WatchHistory.findOneAndDelete({ _id: req.params.id, userId: req.userId });
        if (!history) return res.status(404).json({ error: '기록을 찾을 수 없습니다.' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: '시청 기록 삭제 실패', details: err.message });
    }
});

// 즐겨찾기 추가/삭제 토글 API
app.post('/api/favorites', authMiddleware, async (req, res) => {
    const userId = req.userId;
    const { movieId } = req.body;
    if (!movieId) return res.status(400).json({ error: 'movieId required' });

    try {
        const existing = await Favorite.findOne({ userId, movieId });
        if (existing) {
            await Favorite.deleteOne({ _id: existing._id });
            res.json({ favorited: false });
        } else {
            const fav = new Favorite({ userId, movieId });
            await fav.save();
            res.json({ favorited: true });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to toggle favorite' });
        console.log(err);
    }
});

// 내 즐겨찾기 목록 조회 API
app.get('/api/favorites', authMiddleware, async (req, res) => {
    try {
        const favorites = await Favorite.find({ userId: req.userId })
            .populate('movieId')
            .sort({ createdAt: -1 });
        res.json(favorites);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch favorites' });
        console.log(err);
    }
});

// 내 즐겨찾기 ID 목록 조회 API (리스트 뷰용)
app.get('/api/favorites/ids', authMiddleware, async (req, res) => {
    try {
        const favorites = await Favorite.find({ userId: req.userId }).select('movieId');
        const ids = favorites.map(f => f.movieId ? f.movieId.toString() : null).filter(id => id !== null);
        res.json(ids);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch favorite ids' });
        console.log(err);
    }
});

//updateMoviesWithExtraImages();

// AirPlay 자막 싱크 보정 모니터링 함수
function monitorAndFixSubtitles(hlsPath, ffmpegProcess) {
    let isFinished = false;
    
    // ffmpegProcess 종료 이벤트 감지 (fluent-ffmpeg: end/error, spawn: exit/error)
    const onFinish = () => { isFinished = true; };
    ffmpegProcess.on('end', onFinish);
    ffmpegProcess.on('exit', onFinish);
    ffmpegProcess.on('error', onFinish);

    let ptsFound = false;
    let startPts = 0;
    const processedFiles = new Set();

    const intervalId = setInterval(() => {
        if (isFinished) {
            clearInterval(intervalId);
            // 마지막으로 한 번 더 실행
            fixVttFiles(hlsPath, startPts, processedFiles);
            return;
        }

        if (!ptsFound) {
            fs.readdir(hlsPath, (err, files) => {
                if (err) return;
                // 비디오 세그먼트 찾기 (vtt, m3u8 제외하고 segment로 시작하는 파일)
                const videoSegment = files.find(f => f.startsWith('segment') && !f.endsWith('.vtt') && !f.endsWith('.m3u8'));
                
                if (videoSegment) {
                    const segPath = path.join(hlsPath, videoSegment);
                    // ffprobe로 시작 시간 측정
                    exec(`ffprobe -v error -show_entries format=start_time -of default=noprint_wrappers=1:nokey=1 "${segPath}"`, (error, stdout) => {
                        if (!error && stdout) {
                            const startTime = parseFloat(stdout.trim());
                            if (!isNaN(startTime)) {
                                startPts = Math.floor(startTime * 90000);
                                ptsFound = true;
                                console.log(`[AirPlay Sync] Detected start PTS: ${startPts} from ${videoSegment}`);
                            }
                        }
                    });
                }
            });
        } else {
            // PTS를 찾았으면 VTT 파일 수정
            fixVttFiles(hlsPath, startPts, processedFiles);
        }
    }, 2000); // 2초마다 확인
}

function fixVttFiles(hlsPath, startPts, processedFiles) {
    fs.readdir(hlsPath, (err, files) => {
        if (err) return;
        files.forEach(file => {
            if (file.endsWith('.vtt') && !processedFiles.has(file)) {
                const filePath = path.join(hlsPath, file);
                fs.readFile(filePath, 'utf8', (err, data) => {
                    if (err) return;
                    if (data.startsWith('WEBVTT')) {
                        if (!data.includes('X-TIMESTAMP-MAP')) {
                            const lines = data.split('\n');
                            // WEBVTT 헤더 바로 다음 줄에 삽입
                            lines.splice(1, 0, `X-TIMESTAMP-MAP=MPEGTS:${startPts},LOCAL:00:00:00.000`);
                            const newData = lines.join('\n');
                            fs.writeFile(filePath, newData, 'utf8', (err) => {
                                if (!err) {
                                    // console.log(`[AirPlay Sync] Fixed ${file}`);
                                    processedFiles.add(file);
                                }
                            });
                        } else {
                            processedFiles.add(file);
                        }
                    }
                });
            }
        });
    });
}

// 서버 시작
app.listen(3001, () => {
  console.log('Server is running on port 3001');
});