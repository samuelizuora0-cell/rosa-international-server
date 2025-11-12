require('dotenv').config();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const session = require('express-session');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const app = express();

// ✅ Allow your InfinityFree site to connect
app.use(cors({
  origin: 'https://rosainternationalschool.kesug.com', // your exact InfinityFree URL, no "www"
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// ✅ Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Session setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 } // 1 hour
}));

// ✅ Serve uploaded files and public assets
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Database connection
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10
});

// ✅ File upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// ==================== ROUTES ====================

// 🧑‍💻 Admin Login
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASS
  ) {
    req.session.admin = true;
    return res.json({ success: true, message: 'Login successful' });
  } else {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

// 🧑‍💻 Admin Upload Result
app.post('/api/admin/upload', upload.single('file'), async (req, res) => {
  if (!req.session.admin) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  const { student_name, exam_number, pin } = req.body;
  const filePath = `/uploads/${req.file.filename}`;

  try {
    const conn = await pool.getConnection();
    await conn.query(
      'INSERT INTO results (student_name, exam_number, pin, file_path, upload_date) VALUES (?, ?, ?, ?, NOW())',
      [student_name, exam_number, pin, filePath]
    );
    conn.release();

    res.json({ success: true, message: 'Result uploaded successfully' });
  } catch (error) {
    console.error('DB Error:', error);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// 🎓 Student Verify
app.post('/api/student/verify', async (req, res) => {
  const { examNumber, pin } = req.body;
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query(
      'SELECT * FROM results WHERE exam_number = ? AND pin = ?',
      [examNumber, pin]
    );
    conn.release();

    if (rows.length > 0) {
      res.json({ success: true, result: rows[0] });
    } else {
      res.status(404).json({ success: false, message: 'No result found' });
    }
  } catch (error) {
    console.error('DB Error:', error);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== SERVER START ====================
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
