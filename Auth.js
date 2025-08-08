const express = require('express');

const jwt = require('jsonwebtoken');
const User = require('./models/User');

require('dotenv').config();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const UserActionLog = require('./models/UserActionLog');

const router = express.Router();


// 로그인: 액세스 토큰(1h) + 리프레시 토큰(7d) 발급, 둘 다 JSON으로 반환 (localStorage 방식)
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) {
            console.log("Invalid username" + username);
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            console.log("Invalid password");
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        
        await UserActionLog.create({
            userId: user._id,
            action: 'login',
            details: 'login successful',
           
        });

        const accessToken = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
        const refreshToken = jwt.sign({ userId: user._id, role: user.role }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
        // 클라이언트가 localStorage 등에 저장하도록 JSON으로 반환
        res.json({ accessToken, refreshToken });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
        
        await UserActionLog.create({
            userId: null, // 로그인 실패 시 userId는 null
            action: 'login',
            details: `login failed: ${username}`
        });
    }
});

// 액세스 토큰 재발급 (refresh)
router.post('/refresh', (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        return res.status(401).json({ error: 'No refresh token' });
    }
    try {
        const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
        const accessToken = jwt.sign({ userId: decoded.userId, role: decoded.role }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ accessToken });
    } catch (err) {
        res.status(403).json({ error: 'Invalid refresh token' });
    }
});


module.exports = router;