#!/bin/bash

# ffmpeg 설치 확인
if ! command -v ffmpeg &> /dev/null; then
    echo "Error: ffmpeg가 설치되어 있지 않습니다."
    exit 1
fi

# 인자 확인
if [ "$#" -eq 0 ]; then
    echo "사용법: $0 <영상파일>"
    echo "예시: $0 movie.mp4"
    exit 1
fi

INPUT_FILE="$1"

# 파일 존재 확인
if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: 파일 '$INPUT_FILE'을 찾을 수 없습니다."
    exit 1
fi

# 파일명 분리
DIR=$(dirname "$INPUT_FILE")
FILENAME=$(basename -- "$INPUT_FILE")
EXTENSION="${FILENAME##*.}"
NAME="${FILENAME%.*}"
OUTPUT_FILE="${DIR}/${NAME}_fixed.${EXTENSION}"

echo "변환 시작: $INPUT_FILE -> $OUTPUT_FILE"

# 변환 실행 (헤더 이동)
ffmpeg -i "$INPUT_FILE" -c copy -movflags faststart "$OUTPUT_FILE" -hide_banner -loglevel error

if [ $? -eq 0 ]; then
    echo "✅ 완료! 변환된 파일: $OUTPUT_FILE"
else
    echo "❌ 실패: 변환 중 오류가 발생했습니다."
    exit 1
fi
