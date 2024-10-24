import os
import subprocess
import argparse
from pathlib import Path

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
        'ffmpeg', '-i', input_file,
        '-vf', f"scale=-1:{720 if resolution == '720p' else 1080}",  # 해상도 설정
        '-c:v', 'libx264', 
        '-crf', '20',
        '-preset', 'veryfast',
        '-hls_time', '10',  # 10초 간격으로 세그먼트 생성
        '-hls_playlist_type', 'event',
        '-hls_segment_filename', os.path.join(hls_output_path, 'segment_%03d.ts'),
        '-hls_base_url', f"hls/{base_name}_{resolution}/",
        os.path.join(hls_output_path, 'master.m3u8')  # 최종 출력 파일
    ]

    # FFmpeg 실행
    try:
        print(f"Transcoding {input_file} to HLS ({resolution})...")
        subprocess.run(ffmpeg_cmd, check=True)
        print(f"Completed: {input_file}")
    except subprocess.CalledProcessError as e:
        print(f"Error transcoding {input_file}: {e}")

# 폴더 내 모든 파일에 대해 HLS 트랜스코딩
def transcode_folder(input_folder, output_folder, resolution="720p"):
    # 입력 폴더에서 비디오 파일을 찾음 (mp4 확장자 기준으로 검색)
    for file_name in os.listdir(input_folder):
        input_file = os.path.join(input_folder, file_name)
        if os.path.isfile(input_file) and file_name.endswith(('.mp4', '.mkv', '.avi', '.mov')):
            transcode_to_hls(input_file, output_folder, resolution)

# 파이썬 명령어 라인 인터페이스(CLI) 설정
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="HLS 트랜스코딩 프로그램")
    parser.add_argument("input_folder", help="입력 비디오 파일이 있는 폴더 경로")
    parser.add_argument("output_folder", help="HLS 파일을 저장할 폴더 경로")
    parser.add_argument("--resolution", default="720p", choices=["720p", "1080p"], help="출력 해상도 (기본값: 720p)")
    
    args = parser.parse_args()

    # 입력 폴더의 모든 파일에 대해 트랜스코딩 수행
    transcode_folder(args.input_folder, args.output_folder, args.resolution)
