const axios = require('axios');
const fs_extra = require('fs-extra');
const path = require('path');
const fs = require('fs');

const downloadContents = async (serialNumber, url) => {
    console.log("downloadcontents:" + url);
    if (typeof url === 'string' && (url.startsWith('uploads/') || url.startsWith('uploads\\'))) {
        return url.replace(/\\/g, '/');
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

    const exceptionFilePath = path.join(__dirname, '..', 'trailer_except.txt');
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

  const fallbackUrl = new URL(playlistUrl);
  const fallbackParts = fallbackUrl.pathname.split('/');
  const newFileName = originalFileName.replace('_mhb_w.mp4', '_hhb.m3u8');
  fallbackParts[fallbackParts.length - 1] = newFileName;
  fallbackUrl.pathname = fallbackParts.join('/');
  return fallbackUrl.toString();
}

module.exports = {
    downloadContents,
    updateM3U8Paths,
    transformSubtituteTrailerUrl,
    resolveAvailableTrailerUrlFromPlaylist
};