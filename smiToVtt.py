#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
SMI(SAMI) 자막을 UTF-8로 변환하고, 다국어 지원을 포함하여 SRT/VTT로 변환하는 스크립트.

기능:
  1) smi 파일 인코딩 자동 판별
  2) SMI 파싱 및 언어별 트랙 분리 (KRCC, ENCC 등)
  3) .srt, .vtt 파일 생성
     - 한국어(기본): filename.vtt / filename.srt
     - 기타 언어: filename.en.vtt / filename.en.srt 등

주의:
  - ffmpeg 의존성을 제거하고 순수 Python으로 구현되었습니다.
"""

import argparse
import os
import sys
import re
import html
from pathlib import Path
from typing import Optional, List, Tuple, Dict

# -----------------------------
# 인코딩 판별
# -----------------------------
DEFAULT_CANDIDATES = [
    "cp949",      # 한국어 ANSI 추정
    "euc-kr",     # EUC-KR
    "utf-8",      # UTF-8 (BOM 없음)
    "utf-8-sig",  # UTF-8 BOM
    "latin-1",    # 마지막 안전망
]

def detect_encoding(file_path: Path, candidates: List[str]) -> Tuple[str, str]:
    """
    파일을 읽어 디코딩에 성공한 (인코딩명, 디코딩된 문자열)을 반환.
    """
    data = file_path.read_bytes()
    if data.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig", data.decode("utf-8-sig")

    for enc in candidates:
        try:
            text = data.decode(enc)
            return enc, text
        except UnicodeDecodeError:
            continue

    return "latin-1", data.decode("latin-1", errors="replace")

# -----------------------------
# SMI 파싱 및 변환 로직
# -----------------------------

def ms_to_timestamp(ms: int, separator: str = '.') -> str:
    """밀리초를 HH:MM:SS.mmm (VTT) 또는 HH:MM:SS,mmm (SRT) 형식으로 변환"""
    seconds = ms // 1000
    milliseconds = ms % 1000
    minutes = seconds // 60
    seconds = seconds % 60
    hours = minutes // 60
    minutes = minutes % 60
    return f"{hours:02}:{minutes:02}:{seconds:02}{separator}{milliseconds:03}"

def clean_smi_text(text: str) -> str:
    """SMI 텍스트 정제: 태그 제거, 엔티티 변환, 줄바꿈 정리"""
    if not text:
        return ""
    
    # 1. <br>을 임시 마커로 변경 (공백을 둬서 붙어있는 텍스트 분리 방지)
    text = re.sub(r'<br\s*/?>', ' __BR__ ', text, flags=re.IGNORECASE)
    
    # 2. 기타 태그 제거
    text = re.sub(r'<[^>]+>', '', text)
    
    # 3. HTML 엔티티 디코딩 (&nbsp; 등)
    text = html.unescape(text)
    
    # 4. 모든 공백(줄바꿈, 탭 포함)을 단일 공백으로 치환 (HTML 렌더링 규칙)
    #    SMI 파일 내의 소스 줄바꿈은 실제 줄바꿈이 아닌 공백으로 처리되어야 함
    text = re.sub(r'\s+', ' ', text)
    
    # 5. 마커를 실제 줄바꿈으로 복원
    text = text.replace(' __BR__ ', '\n').replace('__BR__', '\n')
    
    # 6. 각 줄의 앞뒤 공백 제거 및 빈 줄 제거 (연속된 줄바꿈 방지)
    lines = [line.strip() for line in text.split('\n')]
    text = '\n'.join([l for l in lines if l])

    return text.strip()

def parse_smi(content: str) -> Dict[str, List[Dict]]:
    """
    SMI 내용을 파싱하여 언어별 큐 목록을 반환.
    반환: { 'ko': [{'start': 1000, 'end': 2000, 'text': '안녕'}, ...], 'en': ... }
    """
    
    # 1. 언어 클래스 매핑 (CSS 스타일 파싱)
    # 기본 매핑
    lang_map = {
        'KRCC': 'ko', 'KORCC': 'ko', 'KO': 'ko', 'KOREAN': 'ko',
        'ENCC': 'en', 'ENGCC': 'en', 'EN': 'en', 'ENGLISH': 'en',
        'JACC': 'ja', 'JPCC': 'ja', 'JP': 'ja', 'JAPANESE': 'ja',
        'CHCC': 'zh', 'CNCC': 'zh',
    }
    class_map = {} 

    style_match = re.search(r'<STYLE[^>]*>(.*?)</STYLE>', content, re.IGNORECASE | re.DOTALL)
    if style_match:
        style_content = style_match.group(1)
        for match in re.finditer(r'\.(\w+)\s*\{([^}]+)\}', style_content):
            cls_name = match.group(1).upper()
            props = match.group(2)
            
            # lang: ko-KR 찾기
            lang_match = re.search(r'lang:\s*([a-zA-Z-]+)', props, re.IGNORECASE)
            if lang_match:
                code = lang_match.group(1).split('-')[0].lower()
                class_map[cls_name] = code
            elif cls_name in lang_map:
                class_map[cls_name] = lang_map[cls_name]
    
    # 클래스가 명시되지 않은 경우를 대비해 기본값 설정
    if not class_map:
        # KRCC, ENCC가 본문에만 있을 수도 있으므로 기본 매핑 추가
        class_map.update(lang_map)

    # 2. Sync 파싱
    # <SYNC Start=1000> ...
    fragments = re.split(r'<SYNC', content, flags=re.IGNORECASE)
    
    # 언어별 (start_time, text) 리스트
    # tracks_raw['ko'] = [ (1000, "Hello"), (2000, "&nbsp;"), ... ]
    tracks_raw = {} 
    
    for fragment in fragments[1:]: # 첫 번째는 헤더 부분이므로 스킵
        match = re.match(r'\s*Start\s*=\s*(\d+)[^>]*>(.*)', fragment, re.IGNORECASE | re.DOTALL)
        if not match:
            continue
            
        start_ms = int(match.group(1))
        body = match.group(2)
        
        # <P Class=KRCC> 텍스트 추출
        # <P> 태그로 분리
        p_parts = re.split(r'<P', body, flags=re.IGNORECASE)
        
        # P 태그가 없는 경우 (단일 언어 또는 잘못된 포맷)
        # 본문 전체를 'default' 또는 'ko'로 간주
        if len(p_parts) == 1 and p_parts[0].strip():
             text = clean_smi_text(p_parts[0])
             lang = 'ko' # 기본값 한국어
             if lang not in tracks_raw: tracks_raw[lang] = []
             tracks_raw[lang].append((start_ms, text))
             continue

        for part in p_parts:
            part = part.strip()
            if not part: continue
            
            # Class 확인
            cls_match = re.match(r'\s*Class\s*=\s*(\w+)[^>]*>(.*)', part, re.IGNORECASE | re.DOTALL)
            if cls_match:
                cls_name = cls_match.group(1).upper()
                raw_text = cls_match.group(2)
                lang = class_map.get(cls_name, 'ko') # 알 수 없는 클래스는 한국어로 가정
            else:
                # Class 속성이 없는 P 태그 -> 기본 언어(ko)
                if part.startswith('>'): # <P>Text 형태
                    raw_text = part[1:]
                else:
                    raw_text = part
                lang = 'ko'
            
            text = clean_smi_text(raw_text)
            if lang not in tracks_raw: tracks_raw[lang] = []
            tracks_raw[lang].append((start_ms, text))

    # 3. 큐 생성 (Start, End, Text)
    final_tracks = {}
    
    for lang, events in tracks_raw.items():
        cues = []
        # 시간순 정렬
        events.sort(key=lambda x: x[0])
        
        for i in range(len(events)):
            start, text = events[i]
            
            # 텍스트가 없거나 공백(&nbsp; 변환됨)이면 자막이 없는 구간(종료점)으로 간주
            if not text:
                continue
                
            # 종료 시간 결정: 다음 이벤트의 시작 시간
            if i < len(events) - 1:
                end = events[i+1][0]
            else:
                end = start + 3000 # 마지막 자막은 3초 유지
            
            # 유효하지 않은 구간 스킵
            if end <= start:
                continue
                
            cues.append({
                'start': start,
                'end': end,
                'text': text
            })
        
        if cues:
            final_tracks[lang] = cues
            
    return final_tracks

def write_srt(cues: List[Dict], path: Path):
    with open(path, 'w', encoding='utf-8') as f:
        for i, cue in enumerate(cues, 1):
            start = ms_to_timestamp(cue['start'], ',')
            end = ms_to_timestamp(cue['end'], ',')
            f.write(f"{i}\n")
            f.write(f"{start} --> {end}\n")
            f.write(f"{cue['text']}\n\n")

def write_vtt(cues: List[Dict], path: Path):
    with open(path, 'w', encoding='utf-8') as f:
        f.write("WEBVTT\n\n")
        for cue in cues:
            start = ms_to_timestamp(cue['start'], '.')
            end = ms_to_timestamp(cue['end'], '.')
            f.write(f"{start} --> {end}\n")
            f.write(f"{cue['text']}\n\n")

# -----------------------------
# 메인 로직
# -----------------------------
def process_file(in_file: Path, args) -> None:
    if in_file.suffix.lower() != ".smi":
        return

    print(f"처리 중: {in_file}")

    # 1. 인코딩 판별 및 읽기
    enc_candidates = [e.strip() for e in args.encodings.split(",")] if args.encodings else DEFAULT_CANDIDATES
    detected_enc, content = detect_encoding(in_file, enc_candidates)
    print(f"  - 인코딩: {detected_enc}")

    # 2. 파싱
    tracks = parse_smi(content)
    if not tracks:
        print("  - 자막 트랙을 찾을 수 없습니다.")
        return

    base_path = in_file.with_suffix("")
    
    # 3. 저장
    for lang, cues in tracks.items():
        # 파일명 결정
        # ko -> filename.vtt (기본)
        # en -> filename.en.vtt
        if lang == 'ko':
            suffix = ""
        else:
            suffix = f".{lang}"
            
        out_vtt = base_path.parent / f"{base_path.name}{suffix}.vtt"
        out_srt = base_path.parent / f"{base_path.name}{suffix}.srt"
        
        if out_vtt.exists() and not args.overwrite:
            print(f"  - 건너뜀 (이미 존재): {out_vtt.name}")
            continue
            
        write_vtt(cues, out_vtt)
        write_srt(cues, out_srt)
        print(f"  - 생성 완료: {out_vtt.name}, {out_srt.name} ({len(cues)} lines)")


def iter_files(root: Path, recursive: bool) -> List[Path]:
    if root.is_file():
        return [root]
    if recursive:
        return list(root.rglob("*.smi"))
    return list(root.glob("*.smi"))

def main():
    parser = argparse.ArgumentParser(description="SMI를 다국어 지원 SRT/VTT로 변환")
    parser.add_argument("--input", "-i", required=True, help="입력 파일/폴더 경로")
    parser.add_argument("--recursive", "-r", action="store_true", help="폴더 재귀 처리")
    parser.add_argument("--overwrite", "-y", action="store_true", help="덮어쓰기")
    parser.add_argument("--encodings", help=f"인코딩 후보. 기본: {','.join(DEFAULT_CANDIDATES)}")
    args = parser.parse_args()

    root = Path(args.input)
    if not root.exists():
        print(f"경로 없음: {root}", file=sys.stderr)
        sys.exit(1)

    targets = iter_files(root, args.recursive)
    if not targets:
        print("처리할 .smi 파일이 없습니다.")
        sys.exit(0)

    for f in targets:
        try:
            process_file(f, args)
        except Exception as e:
            print(f"오류 ({f.name}): {e}", file=sys.stderr)

    print("완료.")

if __name__ == "__main__":
    main()
