import os
import re
import subprocess
import sys
import math

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
    
    # Find subtitles
    found_subtitles = []
    
    # 1. Default Korean (filename.vtt)
    default_vtt_path = os.path.join(UPLOADS_DIR, filename + '.vtt')
    if os.path.exists(default_vtt_path):
        found_subtitles.append({'lang': 'ko', 'name': 'Korean', 'file': default_vtt_path, 'isDefault': True})
    
    # 2. Additional languages (filename.lang.vtt)
    supported_langs = [
        {'code': 'en', 'name': 'English'},
        {'code': 'ja', 'name': 'Japanese'},
        {'code': 'zh', 'name': 'Chinese'}
    ]
    
    for l in supported_langs:
        lang_vtt_path = os.path.join(UPLOADS_DIR, f"{filename}.{l['code']}.vtt")
        if os.path.exists(lang_vtt_path):
            found_subtitles.append({'lang': l['code'], 'name': l['name'], 'file': lang_vtt_path, 'isDefault': False})
            
    if not found_subtitles:
        print(f"No subtitles found for {dirname}")
        return

    master_path = os.path.join(dir_path, 'master.m3u8')
    video_path = os.path.join(dir_path, 'video.m3u8')

    if not os.path.exists(master_path): 
        print(f"master.m3u8 not found in {dirname}")
        return

    # Check if already processed (if master contains STREAM-INF with SUBTITLES)
    # Note: We might want to re-process if we are updating logic. 
    # But for now let's assume we skip if SUBTITLES="subs" is present.
    # User said "add subtitle info to existing hls without subtitles".
    with open(master_path, 'r', encoding='utf-8') as f:
        content = f.read()
        if 'SUBTITLES="subs"' in content:
            print(f"Already processed (SUBTITLES tag found): {dirname}")
            # We can optionally force update here if needed, but let's stick to "adding" logic.
            return

    print(f"Processing {dirname}...")
    
    # Get video duration and start time from segment_000.ts (more accurate for HLS)
    duration = 0
    start_pts = 0
    
    try:
        segment_0 = os.path.join(dir_path, 'segment_000.ts')
        if os.path.exists(segment_0):
            # Get Start Time
            cmd_start = ['ffprobe', '-v', 'error', '-show_entries', 'format=start_time', '-of', 'default=noprint_wrappers=1:nokey=1', segment_0]
            result_start = subprocess.run(cmd_start, capture_output=True, text=True)
            try:
                start_time = float(result_start.stdout.strip())
                start_pts = int(start_time * 90000)
            except ValueError:
                print(f"Could not parse start time from segment_000.ts for {dirname}")
                start_pts = 0
            
            # Get Duration
            # Try to find original video file
            original_video_extensions = ['.mp4', '.mkv', '.avi', '.mov']
            original_video_path = None
            for ext in original_video_extensions:
                p = os.path.join(UPLOADS_DIR, filename + ext)
                if os.path.exists(p):
                    original_video_path = p
                    break
            
            if original_video_path:
                cmd_dur = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', original_video_path]
                result_dur = subprocess.run(cmd_dur, capture_output=True, text=True)
                try:
                    duration = float(result_dur.stdout.strip())
                except ValueError:
                    duration = 7200
            else:
                # Fallback: Estimate from video.m3u8
                if os.path.exists(video_path):
                    with open(video_path, 'r') as vf:
                        v_content = vf.read()
                        # Sum all EXTINF
                        extinfs = re.findall(r'#EXTINF:([\d\.]+),', v_content)
                        if extinfs:
                            duration = sum(float(x) for x in extinfs)
                        else:
                            duration = 7200
                else:
                    duration = 7200 # Default fallback
                    
            print(f"Detected start PTS: {start_pts}, Duration: {duration}")
            
        else:
            print("segment_000.ts not found, cannot sync subtitles accurately.")
            return

    except Exception as e:
        print(f"Error probing video info: {e}")
        return

    subtitle_media_lines = ""

    for sub in found_subtitles:
        subs_m3u8_name = f"subs_{sub['lang']}.m3u8"
        subs_vtt_name = f"subs_{sub['lang']}.vtt"
        
        subs_m3u8_path = os.path.join(dir_path, subs_m3u8_name)
        full_sub_path = os.path.join(dir_path, subs_vtt_name)
        
        try:
            print(f"Processing subtitles for {sub['lang']}...")
            
            # 1. Read VTT and add Header
            with open(sub['file'], 'r', encoding='utf-8') as f:
                vtt_content = f.read()
            
            lines = vtt_content.split('\n')
            if lines and lines[0].strip().startswith('WEBVTT'):
                # Remove existing header if any
                lines = [l for l in lines if not l.startswith('X-TIMESTAMP-MAP')]
                # Insert new header
                lines.insert(1, f"X-TIMESTAMP-MAP=MPEGTS:{start_pts},LOCAL:00:00:00.000")
                vtt_content = '\n'.join(lines)
            
            # 2. Write modified VTT
            with open(full_sub_path, 'w', encoding='utf-8') as f:
                f.write(vtt_content)
                
            # 3. Create subs m3u8 (Single Segment)
            m3u8_content = f"""#EXTM3U
#EXT-X-TARGETDURATION:{math.ceil(duration)}
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:{duration},
{subs_vtt_name}
#EXT-X-ENDLIST"""

            with open(subs_m3u8_path, 'w', encoding='utf-8') as f:
                f.write(m3u8_content)
                
            # 4. Add to Master Playlist lines
            default_str = 'YES' if sub['isDefault'] else 'NO'
            uri_path = f"hls/{dirname}/{subs_m3u8_name}"
            
            subtitle_media_lines += f'#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="{sub["name"]}",LANGUAGE="{sub["lang"]}",DEFAULT={default_str},AUTOSELECT=YES,URI="{uri_path}"\n'

        except Exception as e:
            print(f"Error processing subtitle {sub['lang']}: {e}")

    # 5. Update Master Playlist
    # We need to replace the existing STREAM-INF line to include SUBTITLES="subs"
    # and prepend the subtitle media lines.
    
    # Read master again
    with open(master_path, 'r', encoding='utf-8') as f:
        master_lines = f.readlines()
        
    new_master_lines = []
    # Insert subtitle lines after #EXTM3U
    if master_lines and master_lines[0].strip() == '#EXTM3U':
        new_master_lines.append(master_lines[0])
        new_master_lines.append(subtitle_media_lines)
        
        # Process the rest
        for line in master_lines[1:]:
            if line.startswith('#EXT-X-STREAM-INF'):
                # Add SUBTITLES="subs" if not present
                if 'SUBTITLES=' not in line:
                    # Append to attributes
                    parts = line.strip().split(':')
                    if len(parts) > 1:
                        attributes = parts[1]
                        new_attributes = attributes + ',SUBTITLES="subs"'
                        new_line = parts[0] + ':' + new_attributes + '\n'
                        new_master_lines.append(new_line)
                    else:
                        new_master_lines.append(line)
                else:
                    new_master_lines.append(line)
            elif line.strip().endswith('video.m3u8'):
                 # Ensure video path matches App.js format: hls/folder/video.m3u8
                 stripped = line.strip()
                 if not stripped.startswith('hls/'):
                     new_master_lines.append(f"hls/{dirname}/{stripped}\n")
                 else:
                     new_master_lines.append(line)
            else:
                new_master_lines.append(line)
    else:
        # Fallback
        new_master_lines = master_lines

    with open(master_path, 'w', encoding='utf-8') as f:
        f.writelines(new_master_lines)
        
    print(f"Updated master.m3u8 for {dirname}")

def main():
    target_name = None
    if len(sys.argv) > 1:
        target_name = sys.argv[1]
        # Remove extension if present
        if target_name.endswith('.vtt'):
            target_name = target_name[:-4]
        print(f"Targeting specific video: {target_name}")

    if not os.path.exists(HLS_DIR):
        print(f"Error: {HLS_DIR} directory not found.")
        return

    for dirname in os.listdir(HLS_DIR):
        if target_name:
            # Check if this directory matches the target name
            match = re.match(r'(.+)_(1080p|720p|4k|2160p)$', dirname)
            if match and match.group(1) == target_name:
                process_directory(dirname)
        else:
            process_directory(dirname)

if __name__ == '__main__':
    main()
