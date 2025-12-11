const express = require('express');
const router = express.Router();
const UserActionLog = require('../models/UserActionLog');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

// 로그 저장 API (/api/user-action-log)
router.post('/user-action-log', authMiddleware, async (req, res) => {
    const { action, targetId, details } = req.body;
    try {
        const log = new UserActionLog({
            userId: req.userId,
            action,
            targetId,
            details
        });
        await log.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: '로그 저장 실패', details: err.message });
    }
});

// 로그인/조회/재생 로그 전체 조회 (관리자만) (/api/admin/user-action-logs)
router.get('/admin/user-action-logs', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const logs = await UserActionLog.find({})
            .populate('userId', 'username')
            .sort({ timestamp: -1 })
            .limit(200);
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: '로그 조회 실패', details: err.message });
    }
});

module.exports = router;