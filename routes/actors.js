const express = require('express');
const router = express.Router();
const Actor = require('../models/Actor');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

// 모든 배우 가져오기
router.get('/', async (req, res) => {
    try {
        const actors = await Actor.find();
        const isKorean = (name) => /[\u3131-\u318E\uAC00-\uD7A3]/.test(name);
        const koreanActors = actors.filter(a => isKorean(a.name)).sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));
        const englishActors = actors.filter(a => !isKorean(a.name)).sort((a, b) => a.name.localeCompare(b.name, 'en'));
        res.json([...koreanActors, ...englishActors]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch actors' });
        console.log(err)
    }
});

// 새로운 배우 추가
router.post('/', authMiddleware, requireAdmin, async (req, res) => {
    const { name } = req.body;
    const actor = new Actor({ name });
    try {
        await actor.save();
        res.status(201).json(actor);
    } catch (err) {
        res.status(500).json({ error: 'Failed to add actor' });
        console.log(err)
    }
});

module.exports = router;