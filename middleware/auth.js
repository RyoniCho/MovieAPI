const jwt = require('jsonwebtoken');
require('dotenv').config();
const JWT_SECRET = process.env.JWT_SECRET;

const authMiddleware = (req, res, next) => {
    let token = req.header('Authorization');
    
    if (!token && req.query.token) {
        token = req.query.token;
    } else if (token) {
        token = token.replace('Bearer ', '');
    }

    if (!token) {
        // console.log(`[AUTH ERROR] Missing Authorization header or token query`);
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        req.userRole = decoded.role;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

const requireAdmin = (req, res, next) => {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ error: '관리자만 접근 가능합니다.' });
    }
    next();
};

module.exports = { authMiddleware, requireAdmin };