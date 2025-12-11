const express = require('express');
const path = require('path');
const cors = require('cors');
const connectDB = require('./config/db');
require('dotenv').config();

const app = express();
const CORS_ORIGIN = process.env.CORS_ORIGIN;

// Connect Database
connectDB();

// Middleware
app.use(cors({
    origin: [CORS_ORIGIN, "http://localhost:3000"],
    credentials: true,
}));
app.use(express.json());

// Static Files
app.use('/uploads', express.static('uploads'));
app.use('/api/hls', express.static(path.join(__dirname, 'hls'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.vtt')) {
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        }
        res.removeHeader('Access-Control-Allow-Origin');
        res.removeHeader('Access-Control-Allow-Credentials');
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
}));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/movies', require('./routes/movies'));
app.use('/api/actors', require('./routes/actors'));
app.use('/api/users', require('./routes/users'));
app.use('/api', require('./routes/logs')); // Mounts /api/user-action-log and /api/admin/user-action-logs
app.use('/api', require('./routes/watchHistory')); // Mounts /api/watch-history and /api/admin/watch-histories
app.use('/api/favorites', require('./routes/favorites'));
app.use('/api/stream', require('./routes/streaming'));

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
