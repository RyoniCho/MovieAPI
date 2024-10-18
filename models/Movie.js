const mongoose = require('mongoose');

// 영화 스키마 정의
const movieSchema = new mongoose.Schema({
  serialNumber: { type: String, required: true, unique: true },
  title: { type: String, required: true },      // 영화 제목 (필수)
  actor: { type: String, required: true },      // 배우(필수)
  image: { type: String, required: true },      // 영화 이미지 파일 경로 (필수)
  extraImage:{type: [String],default:[]},  //Extra Image
  trailer: { type: String, required: true },    // 예고편 영상 파일 경로 (필수)
  mainMovie: {type: String, default:''}, // 영화 메인 본펀 경로 (있을경우에만 사용한다.)
  plexRegistered: { type: Boolean, default: false }, //plex에 등록된건지
  description: { type: String, default: '' },   // 영화 설명 (선택)
  releaseDate: { type: Date, default: Date.now },  // 개봉일 (선택)
  category: {type:String,default:"Unknown"} //카테고리
});

// 영화 모델 생성
const Movie = mongoose.model('Movie', movieSchema);

/*
async function addCategoryToAllMovies() {
  try {
      const result = await Movie.updateMany(
          { category: { $exists: false } }, // category 필드가 없는 문서만 업데이트
          { $set: { category: 'av' } } // 원하는 기본 카테고리 값으로 설정
      );
      console.log(`Updated ${result.nModified} documents.`);
  } catch (error) {
      console.error('Error updating documents:', error);
  } finally {
      mongoose.connection.close();
  }
}

addCategoryToAllMovies();
*/

module.exports = Movie;