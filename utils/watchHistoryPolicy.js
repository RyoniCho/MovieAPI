const mongoose = require('mongoose');
function parseEpisode(value) {
    const n = value === undefined ? -1 : Number(value);
    if (!Number.isInteger(n) || n < -1) throw new Error('Invalid episodeIndex');
    return n;
}
function historyUpdate(body, now = new Date()) {
    const { lastWatchedTime, duration, ended } = body;
    if (typeof lastWatchedTime !== 'number' || !Number.isFinite(lastWatchedTime) || lastWatchedTime < 0) throw new Error('Invalid lastWatchedTime');
    if (duration !== undefined && (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0)) throw new Error('Invalid duration');
    if (ended !== undefined && typeof ended !== 'boolean') throw new Error('Invalid ended');
    const update = { lastWatchedTime: duration ? Math.min(lastWatchedTime, duration) : lastWatchedTime, updatedAt: now };
    // Legacy clients without duration must not reset known completion metadata.
    if (duration !== undefined) {
        update.duration = duration;
        update.completedAt = (ended === true || lastWatchedTime / duration >= 0.95) ? now : null;
    }
    return update;
}
function categoryFilter(category, prefix = '') {
    return { [`${prefix}category`]: category ? category : { $ne: 'AdultVideo' } };
}
function serviceHistoryPipeline(userId, category) {
    return [
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        { $sort: { updatedAt: -1, _id: -1 } },
        { $group: { _id: '$movieId', history: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$history' } },
        { $lookup: { from: 'movies', localField: 'movieId', foreignField: '_id', as: 'movieId' } },
        { $unwind: '$movieId' },
        { $match: categoryFilter(category, 'movieId.') },
        { $sort: { updatedAt: -1, _id: -1 } },
        { $project: { userId: 0 } },
        { $facet: {
            continueWatching: [{ $match: { completedAt: null, lastWatchedTime: { $gt: 0 } } }, { $limit: 20 }],
            recentWatched: [{ $limit: 20 }],
            rewatch: [{ $match: { completedAt: { $ne: null } } }, { $limit: 20 }]
        } }
    ];
}
module.exports = { parseEpisode, historyUpdate, categoryFilter, serviceHistoryPipeline };
