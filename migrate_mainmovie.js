const mongoose = require('mongoose');
const Movie = require('./models/Movie');

mongoose.connect('mongodb://localhost:27017/movies', { useNewUrlParser: true, useUnifiedTopology: true });

async function migrateMainMovieToMap() {
  const movies = await Movie.find({});
  console.log(`Found ${movies.length} movies to process.`);
  for (const movie of movies) {
    let needsMigration = false;
    let oldValue = null;

    // Map(0) {} → skip
    if (
      movie.mainMovie &&
      typeof movie.mainMovie === 'object' &&
      !Array.isArray(movie.mainMovie) &&
      typeof movie.mainMovie.entries === 'function'
    ) {
      const entries = Array.from(movie.mainMovie.entries());
      // 문자별로 쪼개진 경우: 키가 0,1,2... 이고 값이 한 글자씩
      if (
        entries.length > 1 &&
        entries.every(([k, v]) => !isNaN(Number(k)) && typeof v === 'string' && v.length === 1)
      ) {
        oldValue = entries.map(([k, v]) => v).join('');
        needsMigration = true;
      }
    }

    if (needsMigration && oldValue) {
      movie.mainMovie = { '720p': oldValue };
      await movie.save();
      console.log(`Migrated movie: ${movie.title} (${movie.serialNumber})`);
    } else {
      console.log(`No valid mainMovie to migrate for movie: ${movie.title} (${movie.serialNumber})`);
      console.log(`Current mainMovie value:`, movie.mainMovie);
    }
  }
  console.log('Migration complete!');
  mongoose.disconnect();
}

migrateMainMovieToMap();