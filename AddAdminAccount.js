const mongoose = require('mongoose');
const User = require('./models/User');

mongoose.connect('mongodb://localhost:27017/movies', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const seedUser = async () => {
    try {
        const user = new User({
            username: 'admin',
            password: 'password', // 비밀번호는 bcrypt를 통해 자동으로 해시됩니다.
        });
        await user.save();
        console.log('Admin user created');
    } catch (err) {
        console.error(err);
    } finally {
        mongoose.connection.close();
    }
};

seedUser();