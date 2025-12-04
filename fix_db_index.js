const mongoose = require('mongoose');

// MongoDB 연결 설정 (App.js와 동일)
mongoose.connect('mongodb://localhost:27017/movies', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('MongoDB Connected for Maintenance');
    
    try {
      const collection = mongoose.connection.collection('watchhistories');
      
      // 현재 인덱스 목록 조회
      const indexes = await collection.indexes();
      console.log('현재 인덱스 목록:', indexes.map(idx => idx.name));

      // 문제의 인덱스 찾기
      const oldIndexName = 'userId_1_movieId_1';
      const oldIndex = indexes.find(idx => idx.name === oldIndexName);

      if (oldIndex) {
        console.log(`[작업 시작] 옛날 인덱스('${oldIndexName}')가 발견되었습니다. 삭제를 진행합니다...`);
        
        // 인덱스 삭제
        await collection.dropIndex(oldIndexName);
        
        console.log(`[성공] 옛날 인덱스가 삭제되었습니다!`);
        console.log(`이제 'userId + movieId + episodeIndex' 조합으로 새로운 기록이 정상적으로 저장됩니다.`);
      } else {
        console.log(`[완료] 옛날 인덱스가 이미 없습니다. 별도 작업이 필요하지 않습니다.`);
      }

    } catch (err) {
      console.error('[에러] 작업 중 오류 발생:', err.message);
    } finally {
      // 연결 종료
      await mongoose.disconnect();
      console.log('작업 종료');
    }
  })
  .catch(err => console.log('MongoDB Connection Error:', err));
