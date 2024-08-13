const mongoose = require('mongoose');

// 영화 스키마 정의
const movieSchema = new mongoose.Schema({
  serialNumber: { type: String, required: true, unique: true },
  title: { type: String, required: true },      // 영화 제목 (필수)
  actor: { type: String, required: true },      // 배우(필수)
  image: { type: String, required: true },      // 영화 이미지 파일 경로 (필수)
  trailer: { type: String, required: true },    // 예고편 영상 파일 경로 (필수)
  plexRegistered: { type: Boolean, default: false }, //plex에 등록된건지
  description: { type: String, default: '' },   // 영화 설명 (선택)
  releaseDate: { type: Date, default: Date.now },  // 개봉일 (선택)
});

// 영화 모델 생성
const Movie = mongoose.model('Movie', movieSchema);

module.exports = Movie;