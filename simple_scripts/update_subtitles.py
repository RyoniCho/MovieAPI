
import os
import re
import subprocess
import sys
import argparse
import math
import shutil

def get_video_info(hls_folder):
    """HLS 세그먼트에서 비디오 시작 시간과 전체 길이를 가져옵니다."""
    start_pts = 0
    duration = 7200  # 기본값

    try:
        segment_0 = os.path.join(hls_folder, 'segment_000.ts')
        if os.path.exists(segment_0):
            # ffprobe를 사용하여 시작 시간(PTS)을 가져옵니다.
            cmd_start = ['ffprobe', '-v', 'error', '-show_entries', 'format=start_time', '-of', 'default=noprint_wrappers=1:nokey=1', segment_0]
            result_start = subprocess.run(cmd_start, capture_output=True, text=True, check=True)
            start_time = float(result_start.stdout.strip())
            start_pts = int(start_time * 90000) # MPEG-TS 타임스케일
        else:
            print(f"경고: {segment_0} 파일을 찾을 수 없어 정확한 싱크를 맞출 수 없습니다.")

        video_playlist = os.path.join(hls_folder, 'video.m3u8')
        if os.path.exists(video_playlist):
            # video.m3u8 파일에서 모든 #EXTINF 태그의 길이를 합산하여 전체 길이를 계산합니다.
            with open(video_playlist, 'r', encoding='utf-8') as f:
                content = f.read()
                extinfs = re.findall(r'#EXTINF:([\d\.]+),', content)
                if extinfs:
                    duration = sum(float(x) for x in extinfs)
        
        print(f"감지된 정보: 시작 PTS = {start_pts}, 전체 길이 = {duration:.2f}초")
        return start_pts, duration

    except (subprocess.CalledProcessError, ValueError, FileNotFoundError) as e:
        print(f"비디오 정보 추출 중 오류 발생: {e}")
        return start_pts, duration # 오류 발생 시 기본값 반환

def update_subtitles(vtt_file, hls_folder, lang_code, lang_name):
    """HLS 플레이리스트에 자막을 추가하거나 업데이트합니다."""
    if not os.path.exists(vtt_file):
        print(f"오류: VTT 파일 '{vtt_file}'을 찾을 수 없습니다.")
        return

    if not os.path.isdir(hls_folder):
        print(f"오류: HLS 폴더 '{hls_folder}'를 찾을 수 없습니다.")
        return
        
    master_playlist_path = os.path.join(hls_folder, 'master.m3u8')
    if not os.path.exists(master_playlist_path):
        print(f"오류: '{master_playlist_path}' 파일을 찾을 수 없습니다.")
        return

    print(f"'{hls_folder}' 폴더의 자막을 업데이트합니다.")
    print(f"자막 파일: '{vtt_file}', 언어: {lang_name}({lang_code})")

    start_pts, duration = get_video_info(hls_folder)

    # 1. VTT 파일을 HLS 폴더로 복사하고 타임스탬프 헤더를 추가합니다.
    subs_vtt_name = f"subs_{lang_code}.vtt"
    target_vtt_path = os.path.join(hls_folder, subs_vtt_name)

    try:
        with open(vtt_file, 'r', encoding='utf-8') as f:
            vtt_content = f.read()
        
        lines = vtt_content.split('\n')
        # 기존 타임스탬프 맵 제거
        lines = [l for l in lines if not l.startswith('X-TIMESTAMP-MAP')]
        # 새로운 타임스탬프 맵 삽입
        if lines and lines[0].strip().startswith('WEBVTT'):
            lines.insert(1, f"X-TIMESTAMP-MAP=MPEGTS:{start_pts},LOCAL:00:00:00.000")
        
        with open(target_vtt_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))
        print(f"'{target_vtt_path}' 파일 생성 완료.")

    except Exception as e:
        print(f"VTT 파일 처리 중 오류 발생: {e}")
        return

    # 2. 자막용 m3u8 파일을 생성합니다.
    subs_m3u8_name = f"subs_{lang_code}.m3u8"
    subs_m3u8_path = os.path.join(hls_folder, subs_m3u8_name)
    
    subs_m3u8_content = f"""#EXTM3U
#EXT-X-TARGETDURATION:{math.ceil(duration)}
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:{duration:.6f},
{subs_vtt_name}
#EXT-X-ENDLIST"""

    with open(subs_m3u8_path, 'w', encoding='utf-8') as f:
        f.write(subs_m3u8_content)
    print(f"'{subs_m3u8_path}' 파일 생성 완료.")


    # 3. master.m3u8 파일을 수정합니다.
    with open(master_playlist_path, 'r', encoding='utf-8') as f:
        master_lines = f.readlines()

    new_master_lines = []
    subtitle_group_exists = False
    new_subtitle_media_line = f'#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="{lang_name}",LANGUAGE="{lang_code}",DEFAULT=NO,AUTOSELECT=YES,URI="{subs_m3u8_name}"\n'

    # 기존 자막 라인 제거 및 자막 그룹 존재 여부 확인
    for line in master_lines:
        if line.startswith('#EXT-X-MEDIA:TYPE=SUBTITLES'):
            subtitle_group_exists = True
            # 현재 추가하려는 언어와 다른 자막 라인만 유지
            if f'LANGUAGE="{lang_code}"' not in line:
                new_master_lines.append(line)
        else:
            new_master_lines.append(line)

    # 새로운 자막 라인 추가
    inserted = False
    final_lines = []
    for line in new_master_lines:
        # 비디오 스트림 정보 위에 자막 정보를 추가합니다.
        if line.startswith('#EXT-X-STREAM-INF') and not inserted:
            final_lines.append(new_subtitle_media_line)
            inserted = True
        final_lines.append(line)
    
    # 스트림 정보가 없는 경우 파일 끝에 추가 (일반적이지 않은 경우)
    if not inserted:
        final_lines.insert(1, new_subtitle_media_line)


    # 비디오 스트림 정보에 SUBTITLES="subs" 속성 추가
    for i, line in enumerate(final_lines):
        if line.startswith('#EXT-X-STREAM-INF') and 'SUBTITLES=' not in line:
            final_lines[i] = line.strip() + ',SUBTITLES="subs"\n'
    
    with open(master_playlist_path, 'w', encoding='utf-8') as f:
        f.writelines(final_lines)

    print(f"'{master_playlist_path}' 파일 업데이트 완료.")
    print("\n작업 완료!")


def main():
    parser = argparse.ArgumentParser(description="HLS 폴더에 VTT 자막을 추가하거나 업데이트합니다.")
    parser.add_argument("--vtt", required=True, help="입력 VTT 자막 파일 경로")
    parser.add_argument("--hls_folder", required=True, help="대상 HLS 인코딩 폴더 경로")
    parser.add_argument("--lang", default="ko", help="자막의 언어 코드 (예: ko, en)")
    parser.add_argument("--lang_name", default="Korean", help="자막의 언어 이름 (예: Korean, English)")

    args = parser.parse_args()

    update_subtitles(args.vtt, args.hls_folder, args.lang, args.lang_name)

if __name__ == '__main__':
    main()
