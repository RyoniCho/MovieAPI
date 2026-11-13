const test=require('node:test');const assert=require('node:assert/strict');const express=require('express');
const auth=require('../middleware/auth');auth.authMiddleware=(req,res,next)=>{req.userId='507f1f77bcf86cd799439011';next();};
const WatchHistory=require('../models/WatchHistory');const Movie=require('../models/Movie');
const app=express();app.use(express.json());app.use('/api',require('../routes/watchHistory'));app.use('/api/users',require('../routes/users'));
let server,base;
test.before(async()=>{server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base=`http://127.0.0.1:${server.address().port}`;});
test.after(()=>new Promise(resolve=>server.close(resolve)));
test('history rejects invalid requests before any DB call',async()=>{
  const r=await fetch(base+'/api/watch-history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({movieId:'bad',lastWatchedTime:-1})});assert.equal(r.status,400);
});
test('series save validates episode and scopes user',async()=>{
  Movie.findById=()=>({select:async()=>({isSeries:true,episodes:[{},{}]})});
  let saved;
  WatchHistory.findOneAndUpdate=async(f,u)=>{saved={f,u};return u.$set;};
  const r=await fetch(base+'/api/watch-history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({movieId:'507f1f77bcf86cd799439012',episodeIndex:1,lastWatchedTime:99,duration:100})});
  assert.equal(r.status,200);assert.equal(saved.f.userId,'507f1f77bcf86cd799439011');assert.equal(saved.f.episodeIndex,1);assert.ok(saved.u.$set.completedAt);
  const bad=await fetch(base+'/api/watch-history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({movieId:'507f1f77bcf86cd799439012',episodeIndex:3,lastWatchedTime:1})});assert.equal(bad.status,400);
});
test('service home returns facets and filters new additions before limit',async()=>{
  let hp,mp;WatchHistory.aggregate=async p=>{hp=p;return [{continueWatching:[],recentWatched:[],rewatch:[]}];};Movie.aggregate=async p=>{mp=p;return [];};
  const r=await fetch(base+'/api/users/me/service-home?category=Animation');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
  assert.deepEqual(Object.keys(await r.json()).sort(),['continueWatching','recentAdded','recentWatched','rewatch']);
  assert.equal(hp[0].$match.userId.toString(),'507f1f77bcf86cd799439011');assert.equal(mp[0].$match.category,'Animation');assert.equal(mp[3].$limit,20);
  for (const field of ['trailer','description','releaseDate','actor']) assert.equal(mp[4].$project[field],1);
});
