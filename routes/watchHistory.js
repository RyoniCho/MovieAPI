const express = require('express');
const router = express.Router();
const WatchHistory = require('../models/WatchHistory');
const Movie = require('../models/Movie');
const mongoose = require('mongoose');
const { parseEpisode, historyUpdate } = require('../utils/watchHistoryPolicy');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

// 유저별 영화 시청 위치 조회 API (/api/watch-history)
router.get('/watch-history', authMiddleware, async (req, res) => {
    const userId = req.userId;
    const { movieId, episodeIndex } = req.query;
    if (!mongoose.isValidObjectId(movieId)) {
        return res.status(400).json({ error: 'movieId is required' });
    }
    
    let epIdx;
    try { epIdx = parseEpisode(episodeIndex); } catch { return res.status(400).json({ error: 'Invalid episodeIndex' }); }

    try {
        let query = { userId, movieId };
        if (epIdx === -1) {
            query.$or = [{ episodeIndex: -1 }, { episodeIndex: { $exists: false } }];
        } else {
            query.episodeIndex = epIdx;
        }

        const history = await WatchHistory.findOne(query);
        if (history) {
            res.json({ lastWatchedTime: history.lastWatchedTime, duration: history.duration, completedAt: history.completedAt });
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
    const { movieId, episodeIndex } = req.body;
    let epIdx, update;
    try {
        if (!mongoose.isValidObjectId(movieId)) throw new Error('Invalid movieId');
        epIdx = parseEpisode(episodeIndex);
        update = historyUpdate(req.body);
    } catch (error) { return res.status(400).json({ error: error.message }); }
    try {
        const movie = await Movie.findById(movieId).select('isSeries episodes');
        if (!movie) return res.status(404).json({ error: 'Movie not found' });
        if (movie.isSeries ? epIdx < 0 || epIdx >= movie.episodes.length : epIdx !== -1) {
            return res.status(400).json({ error: 'Invalid episode for this movie' });
        }
        const filter = { userId: req.userId, movieId, episodeIndex: epIdx };
        // Reuse pre-episode records only if the canonical record does not exist.
        if (epIdx === -1 && !(await WatchHistory.exists(filter))) {
            const legacy = await WatchHistory.findOne({ userId: req.userId, movieId, episodeIndex: { $exists: false } });
            if (legacy) {
                Object.assign(legacy, update, { episodeIndex: -1 });
                await legacy.save();
                return res.json({ success: true, lastWatchedTime: legacy.lastWatchedTime });
            }
        }
        const updated = await WatchHistory.findOneAndUpdate(filter, { $set: update }, { upsert: true, new: true, runValidators: true });
        res.json({ success: true, lastWatchedTime: updated.lastWatchedTime, completedAt: updated.completedAt });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save watch history' });
        console.error('Watch history save failed:', error.name);
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