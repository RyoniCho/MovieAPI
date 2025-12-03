import os
import re
import subprocess
import sys

# Configuration
UPLOADS_DIR = 'uploads'
HLS_DIR = 'hls'

def get_resolution(dirname):
    if '1080p' in dirname: return '1920x1080'
    if '720p' in dirname: return '1280x720'
    if '4k' in dirname or '2160p' in dirname: return '3840x2160'
    return '1920x1080' # Default

def process_directory(dirname):
    dir_path = os.path.join(HLS_DIR, dirname)
    if not os.path.isdir(dir_path): return

    # Extract filename (remove resolution suffix)
    # Format: name_resolution
    match = re.match(r'(.+)_(1080p|720p|4k|2160p)$', dirname)
    if not match: return
    
    filename = match.group(1)
    resolution_str = match.group(2)
    
    vtt_path = os.path.join(UPLOADS_DIR, filename + '.vtt')
    if not os.path.exists(vtt_path):
        # Check hls/filename.vtt
        vtt_path = os.path.join(HLS_DIR, filename + '.vtt')
        if not os.path.exists(vtt_path):
            print(f"No subtitle found for {dirname} (checked uploads/ and hls/)")
            return

    master_path = os.path.join(dir_path, 'master.m3u8')
    video_path = os.path.join(dir_path, 'video.m3u8')
    subs_path = os.path.join(dir_path, 'subs.m3u8')

    if not os.path.exists(master_path): return

    # Check if already processed (if master contains STREAM-INF)
    with open(master_path, 'r') as f:
        content = f.read()
        if '#EXT-X-STREAM-INF' in content:
            print(f"Already processed: {dirname}")
            return

    print(f"Processing {dirname}...")

    # 1. Generate subtitles
    # ffmpeg -i input.vtt -c:s webvtt -f segment -segment_time 10 -segment_list subs.m3u8 -segment_list_type hls -segment_format webvtt "sub_%03d.vtt"
    
    cmd = [
        'ffmpeg', '-i', vtt_path,
        '-c:s', 'webvtt',
        '-f', 'segment',
        '-segment_time', '10',
        '-segment_list', subs_path,
        '-segment_list_type', 'hls',
        '-segment_format', 'webvtt',
        os.path.join(dir_path, 'sub_%03d.vtt')
    ]
    
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError as e:
        print(f"Error generating subtitles for {dirname}: {e}")
        return

    # 1.5 Post-process VTT segments to add X-TIMESTAMP-MAP
    # AirPlay requires this header for synchronization.
    # We assume MPEGTS:0 corresponds to LOCAL:00:00:00.000
    # Ideally we should match the video PTS, but 0 is a safe default for file-based HLS.
    
    for filename in os.listdir(dir_path):
        if filename.startswith('sub_') and filename.endswith('.vtt'):
            file_path = os.path.join(dir_path, filename)
            with open(file_path, 'r') as f:
                lines = f.readlines()
            
            if lines and lines[0].strip() == 'WEBVTT':
                # Check if header already exists
                if len(lines) > 1 and 'X-TIMESTAMP-MAP' in lines[1]:
                    continue
                
                lines.insert(1, "X-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n")
                
                with open(file_path, 'w') as f:
                    f.writelines(lines)

    # 2. Rename and Rewrite master.m3u8 -> video.m3u8
    # Read old master
    with open(master_path, 'r') as f:
        lines = f.readlines()
    
    # Rewrite lines to remove prefix
    prefix = f"hls/{dirname}/"
    new_lines = []
    for line in lines:
        if line.strip().startswith(prefix):
            new_lines.append(line.replace(prefix, ''))
        else:
            new_lines.append(line)
            
    with open(video_path, 'w') as f:
        f.writelines(new_lines)

    # 3. Create new master.m3u8
    resolution = get_resolution(dirname)
    new_master_content = f"""#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Korean",DEFAULT=YES,AUTOSELECT=YES,URI="hls/{dirname}/subs.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION={resolution},SUBTITLES="subs"
hls/{dirname}/video.m3u8
"""
    with open(master_path, 'w') as f:
        f.write(new_master_content)
    
    print(f"Done: {dirname}")

def main():
    target_name = None
    if len(sys.argv) > 1:
        target_name = sys.argv[1]
        # Remove extension if present
        if target_name.endswith('.vtt'):
            target_name = target_name[:-4]
        print(f"Targeting specific video: {target_name}")

    if not os.path.exists(HLS_DIR):
        print("HLS directory not found")
        return
        
    for dirname in os.listdir(HLS_DIR):
        if target_name:
            # Check if this directory matches the target name
            match = re.match(r'(.+)_(1080p|720p|4k|2160p)$', dirname)
            if match and match.group(1) == target_name:
                process_directory(dirname)
        else:
            process_directory(dirname)

if __name__ == "__main__":
    main()
