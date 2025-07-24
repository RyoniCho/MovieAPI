const mongoose = require('mongoose');

const UserActionLogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true }, // 예: play, pause, stop, seek 등
    targetId: { type: mongoose.Schema.Types.ObjectId }, // 영화 등
    details: { type: String }, // 추가 정보
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('UserActionLog', UserActionLogSchema);
