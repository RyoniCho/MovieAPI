const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEpisode, historyUpdate, categoryFilter, serviceHistoryPipeline } = require('../utils/watchHistoryPolicy');
test('episode index rejects fractions, NaN and negatives below -1', () => {
  assert.equal(parseEpisode(undefined), -1); assert.equal(parseEpisode('2'), 2);
  for (const x of ['bad', 0.5, -2]) assert.throws(() => parseEpisode(x));
});
test('completion requires duration; 95% and ended complete; replay resets', () => {
  const now = new Date();
  assert.equal(historyUpdate({lastWatchedTime: 94, duration:100},now).completedAt,null);
  assert.equal(historyUpdate({lastWatchedTime:95,duration:100},now).completedAt,now);
  assert.equal(historyUpdate({lastWatchedTime:10,duration:100,ended:true},now).completedAt,now);
  assert.equal(historyUpdate({lastWatchedTime:1,duration:100},now).completedAt,null);
  assert.equal('completedAt' in historyUpdate({lastWatchedTime:1}),false);
  assert.equal(historyUpdate({lastWatchedTime:101,duration:100}).lastWatchedTime,100);
});
test('invalid positions and durations rejected', () => {
  for (const n of [NaN, Infinity, -1, '2']) assert.throws(() => historyUpdate({lastWatchedTime:n}));
  for (const n of [0,NaN,Infinity,-1,'2']) assert.throws(() => historyUpdate({lastWatchedTime:1,duration:n}));
  assert.throws(() => historyUpdate({lastWatchedTime:1,ended:'true'}));
});
test('category privacy, account scope, grouping and filtering precede limits', () => {
  assert.deepEqual(categoryFilter(''),{category:{$ne:'AdultVideo'}});
  assert.deepEqual(categoryFilter('Animation'),{category:'Animation'});
  const p=serviceHistoryPipeline('507f1f77bcf86cd799439011','');
  assert.equal(p[0].$match.userId.toString(),'507f1f77bcf86cd799439011');
  assert.equal(p[2].$group._id,'$movieId');
  assert.deepEqual(p[6].$match,{'movieId.category':{$ne:'AdultVideo'}});
  assert.equal(p.at(-1).$facet.continueWatching.at(-1).$limit,20);
});
test('model additions are optional, preserve legacy records and canonical index', () => {
  const WatchHistory=require('../models/WatchHistory'); const Movie=require('../models/Movie');
  const old=new WatchHistory({userId:'507f1f77bcf86cd799439011',movieId:'507f1f77bcf86cd799439012',lastWatchedTime:12});
  assert.equal(old.validateSync(),undefined); assert.equal(old.duration,undefined); assert.equal(old.completedAt,null);
  assert.ok(WatchHistory.schema.indexes().some(([keys,opts])=> keys.episodeIndex===1 && opts.unique));
  assert.ok(Movie.schema.path('addedAt'));
});
