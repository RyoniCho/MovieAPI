import os
import subprocess
import argparse
from pathlib import Path

# 자막 처리 및 싱크 보정 함수
def process_hls_subtitles(video_hls_dir, subtitle_file):
    print(f"Processing subtitles for {video_hls_dir}...")
    
    # 1. VTT 변환 및 복사
    vtt_filename = "subtitles.vtt"
    vtt_path = os.path.join(video_hls_dir, vtt_filename)
    
    cmd_convert = ['ffmpeg', '-y', '-i', subtitle_file, vtt_path]
    subprocess.run(cmd_convert, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    # 2. 자막 세그먼트 생성 (subs.m3u8)
    subs_m3u8_path = os.path.join(video_hls_dir, 'subs.m3u8')
    cmd_segment = [
        'ffmpeg', '-y', '-i', vtt_path,
        '-c:s', 'webvtt', '-f', 'segment', '-segment_time', '10',
        '-segment_list', subs_m3u8_path, '-segment_list_type', 'hls', '-segment_format', 'webvtt',
        os.path.join(video_hls_dir, 'sub_%03d.vtt')
    ]
    subprocess.run(cmd_segment, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    # 3. 비디오 시작 시간(PTS) 측정
    start_pts = 0
    try:
        segment_0 = os.path.join(video_hls_dir, 'segment_000.ts')
        if os.path.exists(segment_0):
            cmd_probe = ['ffprobe', '-v', 'error', '-show_entries', 'format=start_time', '-of', 'default=noprint_wrappers=1:nokey=1', segment_0]
            result = subprocess.run(cmd_probe, capture_output=True, text=True)
            start_time = float(result.stdout.strip())
            start_pts = int(start_time * 90000)
            print(f"  Detected start PTS: {start_pts}")
    except Exception as e:
        print(f"  Warning: Could not probe start time ({e}). Assuming 0.")

    # 4. 자막 세그먼트에 X-TIMESTAMP-MAP 적용
    for filename in os.listdir(video_hls_dir):
        if filename.startswith('sub_') and filename.endswith('.vtt'):
            file_path = os.path.join(video_hls_dir, filename)
            with open(file_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            if lines and lines[0].strip() == 'WEBVTT':
                if len(lines) > 1 and 'X-TIMESTAMP-MAP' not in lines[1]:
                    lines.insert(1, f"X-TIMESTAMP-MAP=MPEGTS:{start_pts},LOCAL:00:00:00.000\n")
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.writelines(lines)

    # 5. Master Playlist 구성
    original_master = os.path.join(video_hls_dir, 'master.m3u8')
    video_playlist = os.path.join(video_hls_dir, 'video.m3u8')
    
    if os.path.exists(original_master):
        os.rename(original_master, video_playlist)
        
        new_master_content = f"""#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Korean",DEFAULT=YES,AUTOSELECT=YES,URI="subs.m3u8",LANGUAGE="ko"
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080,SUBTITLES="subs"
video.m3u8
"""
        with open(original_master, 'w', encoding='utf-8') as f:
            f.write(new_master_content)
            
    print(f"  Subtitle integration completed for {video_hls_dir}")

# HLS 트랜스코딩 함수
def transcode_to_hls(input_file, output_folder, resolution="720p"):
    # 입력 파일의 이름 및 확장자 제거
    base_name = Path(input_file).stem
    # HLS 파일이 저장될 경로 설정
    hls_output_path = os.path.join(output_folder, f"{base_name}_{resolution}")

    # 출력 폴더가 없으면 생성
    os.makedirs(hls_output_path, exist_ok=True)

    # FFmpeg 명령어
    ffmpeg_cmd = [
        'ffmpeg', '-i', f'"{input_file}"',
        '-vf', f"scale=-1:{720 if resolution == '720p' else 1080}",  # 해상도 설정
        '-c:v', 'libx264', 
        '-crf', '20',
        '-preset', 'veryfast',
        '-hls_time', '10',  # 10초 간격으로 세그먼트 생성
        '-hls_playlist_type', 'event',
        '-hls_segment_filename', os.path.join(hls_output_path, 'segment_%03d.ts'),
        '-hls_base_url', f'"hls/{base_name}_{resolution}/"',
        os.path.join(hls_output_path, 'master.m3u8')  # 최종 출력 파일
    ]

    # FFmpeg 실행
    try:
        print(f"Transcoding {input_file} to HLS ({resolution})...")
        subprocess.run(ffmpeg_cmd, check=True)
        print(f"Completed: {input_file}")
        
        # 자막 파일 확인 및 처리
        base_path = os.path.splitext(input_file)[0]
        for ext in ['.srt', '.smi', '.vtt']:
            sub_path = base_path + ext
            if os.path.exists(sub_path):
                process_hls_subtitles(hls_output_path, sub_path)
                break
                
    except subprocess.CalledProcessError as e:
        print(f"Error transcoding {input_file}: {e}")
def ConvertSubscription(input_file, output_folder):
    base_name = Path(input_file).stem

    command = f'ffmpeg -i "{input_file}" "{os.path.join(output_folder,base_name+".vtt")}"'

        # FFmpeg 실행
    try:
        print(f"Convert {input_file} to vtt..")
        subprocess.run(command, check=True)
        print(f"Completed: {input_file}->vtt")
    except subprocess.CalledProcessError as e:
        print(f"Error Convert Subscription {input_file}: {e}")
    pass

# 폴더 내 모든 파일에 대해 HLS 트랜스코딩
def transcode_folder(input_folder, output_folder, resolution="720p"):
    # 입력 폴더에서 비디오 파일을 찾음 (mp4 확장자 기준으로 검색)
  
    for root, dirs, files in os.walk(input_folder):
        for file_name in files:
            input_file = os.path.join(root, file_name)
            if os.path.isfile(input_file) and file_name.endswith(('.mp4', '.mkv', '.avi', '.mov')):
                transcode_to_hls(input_file, output_folder, resolution)
            elif os.path.isfile(input_file) and file_name.endswith(('.smi','.srt')):
                ConvertSubscription(input_file, output_folder)

# 파이썬 명령어 라인 인터페이스(CLI) 설정
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="HLS 트랜스코딩 프로그램")
    parser.add_argument("input_folder", help="입력 비디오 파일이 있는 폴더 경로")
    parser.add_argument("output_folder", help="HLS 파일을 저장할 폴더 경로")
    parser.add_argument("--resolution", default="720p", choices=["720p", "1080p"], help="출력 해상도 (기본값: 720p)")
    
    args = parser.parse_args()

    # 입력 폴더의 모든 파일에 대해 트랜스코딩 수행
    transcode_folder(args.input_folder, args.output_folder, args.resolution)
