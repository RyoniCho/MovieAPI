const express = require('express');
const router = express.Router();
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const fs_extra = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const Movie = require('../models/Movie');

const activeTranscodes = new Map();

// /api/stream
router.get('/', (req, res, next) => {
    const videoPath = req.query.file;
    const resolution = req.query.resolution;
    if (typeof videoPath !== 'string' || !videoPath) {
        return res.status(400).send('File path is required');
    }
    
    let relativeDir = path.dirname(videoPath).replace(/\\/g, '/');
    if (relativeDir === '.') relativeDir = '';

    if (relativeDir.startsWith('uploads/') || relativeDir === 'uploads') {
        relativeDir = relativeDir.replace(/^uploads\/?/, '');
    } else if (relativeDir.startsWith('hls/') || relativeDir === 'hls') {
        relativeDir = relativeDir.replace(/^hls\/?/, '');
    }
    relativeDir = relativeDir.replace(/^\//, '');

    const filenameBase = path.basename(videoPath, path.extname(videoPath));
    const folderName = relativeDir ? `${relativeDir}/${filenameBase}_${resolution}` : `${filenameBase}_${resolution}`;
    const hlsPath = path.join(__dirname, '..', 'hls', ...folderName.split('/'));
    const masterPath = path.join(hlsPath, 'master.m3u8');

    let playlistReady = activeTranscodes.get(masterPath);
    if (!playlistReady) {
        if (fs.existsSync(masterPath)) return res.sendFile(masterPath);
        if (!fs.existsSync(videoPath)) return res.status(404).send('Source video not found');

        playlistReady = transcodeToHls({ videoPath, resolution, movieId: req.query.movieId, hlsPath, folderName, masterPath });
        activeTranscodes.set(masterPath, playlistReady);
    }

    playlistReady.then(() => {
        if (!res.destroyed) res.sendFile(masterPath);
    }, (err) => {
        if (activeTranscodes.get(masterPath) === playlistReady) activeTranscodes.delete(masterPath);
        if (!res.destroyed) next(err);
    });
});

async function transcodeToHls({ videoPath, resolution, movieId, hlsPath, folderName, masterPath }) {

        let scaleValue = 1080;
        if (resolution === '720p') scaleValue = 720;
        else if (resolution === '4k' || resolution === '2160p') scaleValue = 2160;

        let encoder = 'libx264';
        const isMac = process.platform === 'darwin';
        if (process.env.PREFERRED_ENCODER) {
            encoder = process.env.PREFERRED_ENCODER;
        } else {
            if (isMac) {
                encoder = 'h264_videotoolbox';
            } else {
                encoder = 'h264_qsv';
            }
        }

        const useHighQuality = encoder === 'h264_qsv' && resolution === '1080p'
            && typeof movieId === 'string' && /^[a-f\d]{24}$/i.test(movieId)
            && await Movie.exists({
                _id: movieId,
                highQualityEncoding: true,
                $or: [{ 'mainMovie.1080p': videoPath }, { 'episodes.video.1080p': videoPath }]
            });

        fs_extra.ensureDirSync(hlsPath);
        const foundSubtitles = [];
        const dir = path.dirname(videoPath);
        const ext = path.extname(videoPath);
        const baseName = path.basename(videoPath, ext);

        const defaultVttPath = videoPath.replace(ext, '.vtt');
        if (fs.existsSync(defaultVttPath)) {
            foundSubtitles.push({ lang: 'ko', name: 'Korean', file: defaultVttPath, isDefault: true });
        }

        const supportedLangs = [
            { code: 'en', name: 'English' },
            { code: 'ja', name: 'Japanese' },
            { code: 'zh', name: 'Chinese' }
        ];

        supportedLangs.forEach(l => {
            const langVttPath = path.join(dir, `${baseName}.${l.code}.vtt`);
            if (fs.existsSync(langVttPath)) {
                foundSubtitles.push({ lang: l.code, name: l.name, file: langVttPath, isDefault: false });
            }
        });

        const hasSubtitle = foundSubtitles.length > 0;
        
        const command = ffmpeg(videoPath);

        // QSV uses an explicit VBR budget for the high-quality preset.
        const qualityOptions = useHighQuality
            ? ['-preset', 'slow', '-b:v', '8M', '-maxrate:v', '9M', '-bufsize:v', '9M']
            : ['-crf', '20', '-preset', 'veryfast'];
        
        const outputOptions = [
            '-vf', `scale=-1:${scaleValue}`,
            '-c:v', encoder,
            ...qualityOptions,
            '-hls_time', '10',
            '-hls_playlist_type', 'event',
            '-hls_segment_filename', path.join(hlsPath, 'segment_%03d.ts')
        ];
        const mediaPlaylistPath = hasSubtitle ? path.join(hlsPath, 'video.m3u8') : masterPath;

        if (hasSubtitle) {
             outputOptions.push('-hls_base_url', '');

             let subtitleMediaLines = '';

             foundSubtitles.forEach(sub => {
                 const subsM3u8Name = `subs_${sub.lang}.m3u8`;
                 const subsVttName = `subs_${sub.lang}.vtt`;
                 
                 const subsM3u8Path = path.join(hlsPath, subsM3u8Name);
                 const fullSubPath = path.join(hlsPath, subsVttName);
                 
                 const cleanVttPath = sub.file.replace(/\\/g, '/');

                 try {
                     console.log(`Processing subtitles for ${sub.lang} (Single File Mode)...`);
                     
                     let duration = 0;
                     let startPts = 0;

                     try {
                        const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
                        const startTimeCmd = `ffprobe -v error -show_entries format=start_time -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
                        
                        const durationStr = execSync(durationCmd).toString().trim();
                        const startTimeStr = execSync(startTimeCmd).toString().trim();
                        
                        duration = parseFloat(durationStr) || 0;
                        const startTime = parseFloat(startTimeStr) || 0;
                        
                        startPts = Math.floor(startTime * 90000);
                     } catch (probeErr) {
                         console.error("Failed to probe video info:", probeErr);
                         duration = 7200;
                     }

                     let vttContent = fs.readFileSync(cleanVttPath, 'utf8');
                     const lines = vttContent.split('\n');
                     
                     if (lines.length > 0 && lines[0].trim().startsWith('WEBVTT')) {
                         const hasHeader = lines.some(l => l.includes('X-TIMESTAMP-MAP'));
                         if (!hasHeader) {
                              lines.splice(1, 0, `X-TIMESTAMP-MAP=MPEGTS:${startPts},LOCAL:00:00:00.000`);
                              vttContent = lines.join('\n');
                         }
                     }
                     
                     fs.writeFileSync(fullSubPath, vttContent, 'utf8');
                     
                     const m3u8Content = `#EXTM3U
#EXT-X-TARGETDURATION:${Math.ceil(duration)}
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:${duration},
${subsVttName}
#EXT-X-ENDLIST`;
        
                     fs.writeFileSync(subsM3u8Path, m3u8Content, 'utf8');
                     
                     subtitleMediaLines += `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${sub.name}",LANGUAGE="${sub.lang}",DEFAULT=${sub.isDefault?'YES':'NO'},AUTOSELECT=YES,URI="hls/${folderName}/${subsM3u8Name}"\n`;

                 } catch (e) {
                     console.error(`Subtitle processing failed for ${sub.lang}`, e);
                 }
             });

             const bandwidth = (resolution === '4k' || resolution === '2160p') ? '20000000' : '10000000';
             const masterContent = `#EXTM3U
${subtitleMediaLines}#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution === '720p' ? '1280x720' : '1920x1080'},SUBTITLES="subs"
hls/${folderName}/video.m3u8`;
             fs.writeFileSync(masterPath, masterContent);

             command.outputOptions(outputOptions);
             command.output(mediaPlaylistPath);
             
             command.on('start', () => {
                console.log('HLS 트랜스코딩 시작 (Video Only mode for Multi-Subtitle support)');
             });

        } else {
            outputOptions.push('-hls_base_url', `hls/${folderName}/`);
            
            command.outputOptions(outputOptions);
            command.output(mediaPlaylistPath)
                   .on('start', () => {
                        console.log('HLS 트랜스코딩 시작 (encoder: ' + encoder + ')');
                   });
        }

        return new Promise((resolve, reject) => {
            // Wait for the media playlist even if the subtitle master already exists.
            const playlistTimer = setInterval(() => {
                if (fs.existsSync(mediaPlaylistPath)) {
                    clearInterval(playlistTimer);
                    resolve();
                }
            }, 250);

            const onError = (err) => {
                clearInterval(playlistTimer);
                for (const playlistPath of new Set([masterPath, mediaPlaylistPath])) {
                    try {
                        fs.rmSync(playlistPath, { force: true });
                    } catch (cleanupErr) {
                        console.error('Failed to remove incomplete HLS playlist:', cleanupErr);
                    }
                }
                activeTranscodes.delete(masterPath);
                console.error('HLS 트랜스코딩 오류:', err);
                reject(err);
            };

            command
                .on('end', () => {
                    if (!fs.existsSync(mediaPlaylistPath)) return onError(new Error('HLS playlist was not generated'));

                    clearInterval(playlistTimer);
                    activeTranscodes.delete(masterPath);
                    resolve();
                    console.log('HLS 트랜스코딩 완료');
                    fs.unlink(videoPath, (err) => {
                        if (err) console.error('Failed to remove source video:', err);
                        else console.log(`${videoPath} : file removed`);
                    });
                })
                .on('stderr', (stderr) => {
                    console.log('stderr 로그:', stderr);
                })
                .on('error', onError);

            try {
                command.run();
            } catch (err) {
                onError(err);
            }
        });
}

module.exports = router;
