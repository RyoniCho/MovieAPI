const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const randomStr = Math.random().toString(16).slice(2, 8);
        const fileName = req.body.serialNumber + "_" + Date.now() + "_" + randomStr + ext;
        cb(null, fileName);
    },
});

const upload = multer({ storage });

module.exports = upload;