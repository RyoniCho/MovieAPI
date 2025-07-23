const mongoose = require('mongoose');

const WatchHistorySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    movieId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie', required: true },
    lastWatchedTime: { type: Number, default: 0 }, // 초 단위
    updatedAt: { type: Date, default: Date.now }
});

WatchHistorySchema.index({ userId: 1, movieId: 1 }, { unique: true });

module.exports = mongoose.model('WatchHistory', WatchHistorySchema);
