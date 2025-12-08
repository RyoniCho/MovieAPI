

#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
SMI(SAMI) 자막을 UTF-8로 변환하고, ffmpeg로 SRT/VTT로 만드는 스크립트.

기능:
  1) smi 파일 인코딩 자동 판별 및 UTF-8로 재저장
  2) ffmpeg를 호출해 .srt, .vtt 변환
  3) 단일 파일/폴더 일괄 처리 지원

주의:
  - ffmpeg가 PATH에 있어야 합니다.
  - "ANSI"로 저장된 한글 자막은 대부분 cp949입니다.
"""

import argparse
import os
import sys
import subprocess
from pathlib import Path
from typing import Optional, List, Tuple


# -----------------------------
# 인코딩 판별 & UTF-8 변환
# -----------------------------
DEFAULT_CANDIDATES = [
    "cp949",      # 한국어 ANSI 추정
    "euc-kr",     # EUC-KR
    "utf-8",      # UTF-8 (BOM 없음)
    "utf-8-sig",  # UTF-8 BOM
    "latin-1",    # 마지막 안전망 (깨짐 발생 가능)
]


def detect_encoding(file_path: Path, candidates: List[str]) -> Tuple[str, bytes]:
    """
    후보 인코딩을 순서대로 시도하여, 성공한 첫 인코딩을 반환.
    반환: (인코딩명, 원본 바이너리)
    """
    data = file_path.read_bytes()
    # 간단한 BOM 힌트
    if data.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig", data

    # 시도 순서대로 디코딩 성공 확인
    for enc in candidates:
        try:
            _ = data.decode(enc)  # strict
            return enc, data
        except UnicodeDecodeError:
            continue

    # 모두 실패하면 latin-1로 강제 해석
    return "latin-1", data


def convert_to_utf8(src: Path, dst: Path, candidates: List[str], overwrite: bool = False) -> str:
    """
    src SMI를 UTF-8로 변환하여 dst에 저장.
    반환: 판별된 원본 인코딩명
    """
    if dst.exists() and not overwrite:
        raise FileExistsError(f"이미 존재: {dst} (덮어쓰려면 --overwrite 사용)")

    enc, raw = detect_encoding(src, candidates)
    text = raw.decode(enc)
    # 줄바꿈 정규화(선택적): CRLF → LF
    text = text.replace("\r\n", "\n")

    dst.write_text(text, encoding="utf-8")
    return enc


# -----------------------------
# ffmpeg 변환
# -----------------------------
def run_ffmpeg_to_subs(input_smi_utf8: Path, out_srt: Path, out_vtt: Path, overwrite: bool = False) -> None:
    """
    ffmpeg를 사용해 UTF-8 SMI를 SRT/VTT로 변환.
    참고: 텍스트 자막 입력에 대해 -sub_charenc로 인코딩 지정 가능하지만
         이미 UTF-8로 변환했으므로 명시적으로 utf-8을 지정해 안전하게 처리.
    """
    yflag = "-y" if overwrite else "-n"

    # SRT
    cmd_srt = [
        "ffmpeg", yflag,
        "-sub_charenc", "utf-8",
        "-i", str(input_smi_utf8),
        "-c:s", "srt",
        str(out_srt),
    ]
    # VTT
    cmd_vtt = [
        "ffmpeg", yflag,
        "-sub_charenc", "utf-8",
        "-i", str(input_smi_utf8),
        "-c:s", "webvtt",
        str(out_vtt),
    ]

    # 실제 실행
    for label, cmd in [("SRT", cmd_srt), ("VTT", cmd_vtt)]:
        try:
            print(f"[ffmpeg] {label} 변환 실행: {' '.join(cmd)}")
            subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except subprocess.CalledProcessError as e:
            # ffmpeg는 stderr에 상세 사유를 남김
            print(f"ffmpeg {label} 변환 실패:\n{e.stderr.decode(errors='ignore')}", file=sys.stderr)
            raise


# -----------------------------
# 작업 흐름
# -----------------------------
def process_file(in_file: Path, args) -> None:
    if in_file.suffix.lower() != ".smi":
        print(f"건너뜀(확장자 아님): {in_file}")
        return

    print(f"처리 중: {in_file}")

    # 출력 파일 경로
    base = in_file.with_suffix("")  # 확장자 제거
    out_utf8 = in_file.with_suffix(".utf8.smi")
    out_srt  = in_file.with_suffix(".srt")
    out_vtt  = in_file.with_suffix(".vtt")

    # 1) UTF-8 변환
    enc_candidates = [e.strip() for e in args.encodings.split(",")] if args.encodings else DEFAULT_CANDIDATES
    detected = convert_to_utf8(in_file, out_utf8, enc_candidates, overwrite=args.overwrite)
    print(f"인코딩 판별: {detected} → UTF-8로 저장: {out_utf8.name}")

    # 2) ffmpeg 변환
    run_ffmpeg_to_subs(out_utf8, out_srt, out_vtt, overwrite=args.overwrite)
    print(f"변환 완료: {out_srt.name}, {out_vtt.name}\n")


def iter_files(root: Path, recursive: bool) -> List[Path]:
    if root.is_file():
        return [root]
    if recursive:
        return list(root.rglob("*.smi"))
    return list(root.glob("*.smi"))


def main():
    parser = argparse.ArgumentParser(description="SMI를 UTF-8로 변환 후 ffmpeg로 SRT/VTT 생성")
    parser.add_argument("--input", "-i", required=True, help="입력 파일/폴더 경로 (smi 또는 폴더)")
    parser.add_argument("--recursive", "-r", action="store_true", help="폴더 내 하위까지 재귀 처리")
    parser.add_argument("--overwrite", "-y", action="store_true", help="기존 출력 파일 덮어쓰기")
    parser.add_argument("--encodings", help=f"인코딩 후보(쉼표로 구분). 기본: {','.join(DEFAULT_CANDIDATES)}")
    args = parser.parse_args()

    root = Path(args.input)
    if not root.exists():
        print(f"입력 경로가 존재하지 않습니다: {root}", file=sys.stderr)
        sys.exit(1)

    targets = iter_files(root, args.recursive)
    if not targets:
        print("처리할 .smi 파일을 찾지 못했습니다.")
        sys.exit(0)

    for f in targets:
        try:
            process_file(f, args)
        except Exception as e:
            print(f"오류 발생: {f} → {e}", file=sys.stderr)

    print("모든 작업 완료.")


if __name__ == "__main__":
    main()
