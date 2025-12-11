const express = require('express');
const router = express.Router();
const WatchHistory = require('../models/WatchHistory');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

// 유저별 영화 시청 위치 조회 API (/api/watch-history)
router.get('/watch-history', authMiddleware, async (req, res) => {
    const userId = req.userId;
    const { movieId, episodeIndex } = req.query;
    if (!movieId) {
        return res.status(400).json({ error: 'movieId is required' });
    }
    
    const epIdx = episodeIndex !== undefined ? parseInt(episodeIndex) : -1;

    try {
        let query = { userId, movieId };
        if (epIdx === -1) {
            query.$or = [{ episodeIndex: -1 }, { episodeIndex: { $exists: false } }];
        } else {
            query.episodeIndex = epIdx;
        }

        const history = await WatchHistory.findOne(query);
        if (history) {
            res.json({ lastWatchedTime: history.lastWatchedTime });
        } else {
            res.json({ lastWatchedTime: 0 });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch watch history' });
        console.log(err);
    }
});

// 유저별 영화 시청 위치 저장/업데이트 API (/api/watch-history)
router.post('/watch-history', authMiddleware, async (req, res) => {
    const userId = req.userId;
    const { movieId, lastWatchedTime, episodeIndex } = req.body;
    if (!movieId || typeof lastWatchedTime !== 'number') {
        return res.status(400).json({ error: 'movieId와 lastWatchedTime(Number)가 필요합니다.' });
    }

    const epIdx = episodeIndex !== undefined ? parseInt(episodeIndex) : -1;

    try {
        let filter = { userId, movieId, episodeIndex: epIdx };
        
        if (epIdx === -1) {
             const existing = await WatchHistory.findOne({ userId, movieId, episodeIndex: { $exists: false } });
             if (existing) {
                 existing.episodeIndex = -1;
                 existing.lastWatchedTime = lastWatchedTime;
                 existing.updatedAt = Date.now();
                 await existing.save();
                 return res.json({ success: true, lastWatchedTime: existing.lastWatchedTime });
             }
        }

        const updated = await WatchHistory.findOneAndUpdate(
            { userId, movieId, episodeIndex: epIdx },
            { lastWatchedTime, updatedAt: Date.now() },
            { upsert: true, new: true }
        );
        res.json({ success: true, lastWatchedTime: updated.lastWatchedTime });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save watch history' });
        console.log(err);
    }
});

// 영화별 재생 위치(WatchHistory) 전체 조회 (관리자만) (/api/admin/watch-histories)
router.get('/admin/watch-histories', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const histories = await WatchHistory.find({})
            .populate('userId', 'username')
            .populate('movieId', 'title serialNumber')
            .sort({ updatedAt: -1 })
            .limit(200);
        res.json(histories);
    } catch (err) {
        res.status(500).json({ error: '시청 기록 조회 실패', details: err.message });
    }
});

module.exports = router;