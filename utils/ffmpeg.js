const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs_extra = require('fs-extra');
const path = require('path');
const fs = require('fs');
const { exec, execSync } = require('child_process');
const { updateM3U8Paths } = require('./downloader');

async function handleHLSDownload(m3u8Url, outputFilePath) {
    try {
      const response = await axios.get(m3u8Url);
      const m3u8Content = response.data;
  
      const tempM3U8Path = path.join(__dirname, '..', 'temp.m3u8');
      await fs_extra.outputFile(tempM3U8Path, m3u8Content);

      const absoluteOutputPath = path.resolve(__dirname, '..', outputFilePath);

     const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);

     updateM3U8Paths(tempM3U8Path,baseUrl);
  
      return new Promise((resolve, reject) => {
        ffmpeg(tempM3U8Path)
          .inputOptions([
            '-protocol_whitelist', 'file,http,https,tcp,tls',
          ])
          .outputOptions([
            '-c:v', 'libx264',
            '-c:a', 'aac',
            '-strict', 'experimental',
            '-hls_base_url', baseUrl,
          ])
          .on('start', () => console.log('HLS to MP4 conversion started'))
          .on('end', () => {
            console.log('HLS to MP4 conversion completed');
            fs.unlinkSync(tempM3U8Path);
            resolve(absoluteOutputPath);
          })
          .on('error', (err) => {
            console.error('Error during conversion:', err);
            reject(err);
          })
          .on('stderr', (stderrLine) => {
            console.log('FFmpeg stderr:', stderrLine);
          })
          .save(absoluteOutputPath);
      });
    } catch (err) {
      console.error('Error handling HLS download:', err);
      throw err;
    }
}

function monitorAndFixSubtitles(hlsPath) {
    const segment0Path = path.join(hlsPath, 'segment_000.ts');
    let attempts = 0;
    const maxAttempts = 300;

    const checkInterval = setInterval(() => {
        attempts++;
        if (attempts > maxAttempts) {
            console.log('[AirPlay Sync] Timeout waiting for segment_000.ts');
            clearInterval(checkInterval);
            return;
        }

        if (fs.existsSync(segment0Path)) {
            exec(`ffprobe -v error -show_entries format=start_time -of default=noprint_wrappers=1:nokey=1 "${segment0Path}"`, (error, stdout) => {
                if (!error && stdout) {
                    const startTime = parseFloat(stdout.trim());
                    if (!isNaN(startTime)) {
                        const startPts = Math.floor(startTime * 90000);
                        console.log(`[AirPlay Sync] Detected start PTS: ${startPts}. Patching VTT files...`);
                        
                        fs.readdir(hlsPath, (err, files) => {
                            if (err) return;
                            files.forEach(file => {
                                if (file.startsWith('subs_') && file.endsWith('.vtt')) {
                                    const vttFile = path.join(hlsPath, file);
                                    try {
                                        let lines = fs.readFileSync(vttFile, 'utf8').split('\n');
                                        if (lines.length > 0 && lines[0].trim().startsWith('WEBVTT')) {
                                            lines = lines.filter(l => !l.startsWith('X-TIMESTAMP-MAP'));
                                            lines.splice(1, 0, `X-TIMESTAMP-MAP=MPEGTS:${startPts},LOCAL:00:00:00.000`);
                                            fs.writeFileSync(vttFile, lines.join('\n'), 'utf8');
                                        }
                                    } catch (e) {
                                        console.error(`[AirPlay Sync] Error patching ${file}:`, e);
                                    }
                                }
                            });
                            console.log('[AirPlay Sync] VTT patching completed.');
                        });
                        
                        clearInterval(checkInterval);
                    }
                }
            });
        }
    }, 100);
}

module.exports = { handleHLSDownload, monitorAndFixSubtitles };