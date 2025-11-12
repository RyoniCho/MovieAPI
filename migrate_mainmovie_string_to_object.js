// migrate_mainmovie_string_to_object.js
// mainMovie가 string 타입인 영화들을 빈 객체({})로 변환

const mongoose = require('mongoose');
const Movie = require('./models/Movie');

async function migrateMainMovieStringToObject() {
  await mongoose.connect('mongodb://localhost:27017/movies', { useNewUrlParser: true, useUnifiedTopology: true });
  try {
    const result = await Movie.updateMany(
      { mainMovie: { $type: 'string' } },
      { $set: { mainMovie: {} } }
    );
    console.log(`mainMovie가 string인 영화 ${result.modifiedCount || result.nModified}개를 빈 객체로 변환 완료.`);
  } catch (err) {
    console.error('마이그레이션 오류:', err);
  } finally {
    await mongoose.disconnect();
  }
}

migrateMainMovieStringToObject();
