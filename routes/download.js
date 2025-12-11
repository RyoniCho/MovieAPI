const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, (req, res) => {
    const videoPath = req.query.file;
    const resolution = req.query.resolution || '1080p'; // 기본값

    if (!videoPath) {
        return res.status(400).send('File path is required');
    }

    // HLS 폴더 경로 구성 (api/stream과 동일한 로직)
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
        const prefixToRemove = `hls/${folderName}/`;
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
            // 에러 발생 시에도 임시 파일 삭제 시도
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
            // 완료 후 임시 파일 삭제
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

module.exports = router;