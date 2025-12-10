import os
import sys
import subprocess

def convert_files(base_name):
    # 현재 스크립트가 있는 폴더
    folder = os.path.dirname(os.path.abspath(__file__))
    files = os.listdir(folder)
    
    # 대상 파일 찾기
    matched_files = [f for f in files if base_name in f]
    print(f"Matched files: {matched_files}")

    mp4_done = False
    srt_done = False
    vtt_done = False

    for f in matched_files:
        full_path = os.path.join(folder, f)
        if f.lower().endswith('.mp4'):
            new_name = f"{base_name}.mp4"
            if f != new_name:
                os.rename(full_path, os.path.join(folder, new_name))
            mp4_done = True
        elif f.lower().endswith('.srt'):
            new_name = f"{base_name}.srt"
            if f != new_name:
                os.rename(full_path, os.path.join(folder, new_name))
            srt_done = True
    
    # vtt 변환
    srt_path = os.path.join(folder, f"{base_name}.srt")
    vtt_path = os.path.join(folder, f"{base_name}.vtt")
    if srt_done and not os.path.exists(vtt_path):
        try:
            subprocess.run([
                'ffmpeg', '-y', '-i', srt_path, vtt_path
            ], check=True)
            vtt_done = True
            print(f"VTT created: {vtt_path}")
        except subprocess.CalledProcessError as e:
            print(f"ffmpeg error: {e}")
    else:
        if not srt_done:
            print("No SRT file found for conversion.")
        elif os.path.exists(vtt_path):
            print("VTT file already exists.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python MF.py <base_filename>")
        sys.exit(1)
    base_name = sys.argv[1]
    convert_files(base_name)
