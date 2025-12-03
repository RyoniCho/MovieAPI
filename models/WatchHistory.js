const mongoose = require('mongoose');

const WatchHistorySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    movieId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie', required: true },
    episodeIndex: { type: Number, default: -1 }, // -1: Main Movie, 0+: Episode Index
    lastWatchedTime: { type: Number, default: 0 }, // 초 단위
    updatedAt: { type: Date, default: Date.now }
});

// 기존 인덱스 제거 후 복합 인덱스 생성 권장 (MongoDB 콘솔에서 db.watchhistories.dropIndex(...) 필요할 수 있음)
// 여기서는 정의만 변경함.
WatchHistorySchema.index({ userId: 1, movieId: 1, episodeIndex: 1 }, { unique: true });

module.exports = mongoose.model('WatchHistory', WatchHistorySchema);
