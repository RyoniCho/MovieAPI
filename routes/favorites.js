const express = require('express');
const router = express.Router();
const Favorite = require('../models/Favorite');
const { authMiddleware } = require('../middleware/auth');

// 즐겨찾기 추가/삭제 토글 API (/api/favorites)
router.post('/', authMiddleware, async (req, res) => {
    const userId = req.userId;
    const { movieId } = req.body;
    if (!movieId) return res.status(400).json({ error: 'movieId required' });

    try {
        const existing = await Favorite.findOne({ userId, movieId });
        if (existing) {
            await Favorite.deleteOne({ _id: existing._id });
            res.json({ favorited: false });
        } else {
            const fav = new Favorite({ userId, movieId });
            await fav.save();
            res.json({ favorited: true });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to toggle favorite' });
        console.log(err);
    }
});

// 내 즐겨찾기 목록 조회 API (/api/favorites)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const favorites = await Favorite.find({ userId: req.userId })
            .populate('movieId')
            .sort({ createdAt: -1 });
        res.json(favorites);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch favorites' });
        console.log(err);
    }
});

// 내 즐겨찾기 ID 목록 조회 API (/api/favorites/ids)
router.get('/ids', authMiddleware, async (req, res) => {
    try {
        const favorites = await Favorite.find({ userId: req.userId }).select('movieId');
        const ids = favorites.map(f => f.movieId ? f.movieId.toString() : null).filter(id => id !== null);
        res.json(ids);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch favorite ids' });
        console.log(err);
    }
});

module.exports = router;