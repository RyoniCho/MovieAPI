import argparse
import os
import re
import shutil

def ModifyFile(input_path, target, replace):
    # 파일이나 폴더가 존재하는지 확인
    if not os.path.exists(input_path):
        print(f"Error: 파일이나 폴더 '{input_path}'이(가) 존재하지 않습니다.")
        return

    # m3u8 파일들을 찾기
    files_to_modify = []
    if os.path.isfile(input_path) and input_path.endswith(".m3u8"):
        files_to_modify.append(input_path)
    elif os.path.isdir(input_path):
        for root, _, files in os.walk(input_path):
            for file in files:
                if file.endswith(".m3u8"):
                    files_to_modify.append(os.path.join(root, file))

    # 파일이 없는 경우 종료
    if not files_to_modify:
        print("Error: m3u8 파일을 찾을 수 없습니다.")
        return

    # 파일 수정하기
    for file_path in files_to_modify:
        backup_path = file_path + "_backup"

        # 백업 생성
        shutil.copy2(file_path, backup_path)
        print(f"백업 생성: {backup_path}")

        # 파일 내용 수정
        with open(file_path, 'r', encoding='utf-8') as file:
            content = file.read()
        
        # 대체 작업 수행
        # re.escape()를 사용해 target 문자열이 정확히 일치하도록
        modified_content = re.sub(re.escape(target), replace, content)

        # 변경사항 저장
        with open(file_path, 'w', encoding='utf-8') as file:
            file.write(modified_content)
        
        print(f"수정 완료: {file_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="m3u8 파일 내 경로 변경")
    parser.add_argument("--i", required=True, help="m3u8 파일 혹은 해당 파일이 들어있는 폴더 경로")
    parser.add_argument("--target", required=True, help="바꾸고자 하는 문자열")
    parser.add_argument("--replace", required=True, help="대체하려는 문자열")

    args = parser.parse_args()

    ModifyFile(args.i, args.target, args.replace)