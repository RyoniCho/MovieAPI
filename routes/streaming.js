const express = require('express');
const router = express.Router();
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const fs_extra = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

// /api/stream
router.get('/', (req, res) => {
    const videoPath = req.query.file;
    const resolution = req.query.resolution;
    
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
    
    fs_extra.ensureDirSync(hlsPath);

    if (fs.existsSync(path.join(hlsPath, 'master.m3u8'))) {
      return res.sendFile(path.join(hlsPath, 'master.m3u8'));
    } 

    console.log("ffmpeg start");

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
        
        const outputOptions = [
            '-vf', `scale=-1:${scaleValue}`,
            '-c:v', encoder,
            '-crf', '20',
            '-preset', 'veryfast',
            '-hls_time', '10',
            '-hls_playlist_type', 'event',
            '-hls_segment_filename', path.join(hlsPath, 'segment_%03d.ts')
        ];

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
             fs.writeFileSync(path.join(hlsPath, 'master.m3u8'), masterContent);

             command.outputOptions(outputOptions);
             command.output(path.join(hlsPath, 'video.m3u8'));
             
             command.on('start', () => {
                console.log('HLS 트랜스코딩 시작 (Video Only mode for Multi-Subtitle support)');
             });

        } else {
            outputOptions.push('-hls_base_url', `hls/${folderName}/`);
            
            command.outputOptions(outputOptions);
            command.output(path.join(hlsPath, 'master.m3u8'))
                   .on('start', () => {
                        console.log('HLS 트랜스코딩 시작 (encoder: ' + encoder + ')');
                   });
        }

        command
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
            })
            .run();
});

module.exports = router;