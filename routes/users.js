const express = require('express');
const router = express.Router();
const User = require('../models/User');
const WatchHistory = require('../models/WatchHistory');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

// 관리자만 접근 가능: 유저 생성 (/api/users)
router.post('/', authMiddleware, requireAdmin, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
        return res.status(400).json({ error: 'username, password, role 필요' });
    }
    try {
        const user = new User({ username, password, role });
        await user.save();
        res.status(201).json({ success: true, user });
    } catch (err) {
        console.error('유저 생성 실패:', err);
        res.status(500).json({ error: '유저 생성 실패', details: err.message });
    }
});

// 내 최근 시청 기록 조회 (로그인 유저) (/api/users/me/watch-histories)
router.get('/me/watch-histories', authMiddleware, async (req, res) => {
    try {
        const histories = await WatchHistory.find({ userId: req.userId })
            .populate('movieId')
            .sort({ updatedAt: -1 })
            .limit(50);
        res.json(histories);
    } catch (err) {
        res.status(500).json({ error: '내 시청 기록 조회 실패', details: err.message });
    }
});

// 내 시청 기록 개별 삭제 (로그인 유저) (/api/users/me/watch-histories/:id)
router.delete('/me/watch-histories/:id', authMiddleware, async (req, res) => {
    try {
        const history = await WatchHistory.findOneAndDelete({ _id: req.params.id, userId: req.userId });
        if (!history) return res.status(404).json({ error: '기록을 찾을 수 없습니다.' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: '시청 기록 삭제 실패', details: err.message });
    }
});

module.exports = router;