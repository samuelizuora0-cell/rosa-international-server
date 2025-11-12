require('dotenv').config();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 10000;
const UPLOAD_DIR = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// ✅ CORS setup for InfinityFree frontend
app.use(cors({
  origin: 'https://rosainternationalschool.kesug.com', // InfinityFree site URL
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// ✅ Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Session setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'rosa_international_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 } // 1 hour
}));

// ✅ Static folders
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ✅ MySQL Connection using Railway
const DATABASE_URL = process.env.DATABASE_URL || 'mysql://root:TfEdRGUZlwebqUITwnpOBwXxSnusfjlI@crossover.proxy.rlwy.net:37027/railway';

let pool;
try {
  pool = mysql.createPool(DATABASE_URL);
  console.log('✅ Connected to MySQL Database');
} catch (err) {
  console.error('❌ Database connection failed:', err.message);
}

// ✅ Ensure results table exists
(async () => {
  try {
    const conn = await pool.getConnection();
    await conn.query(`
      CREATE TABLE IF NOT EXISTS results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_name VARCHAR(255) NOT NULL,
        exam_number VARCHAR(100),
        pin VARCHAR(100),
        file_path VARCHAR(500),
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    conn.release();
    console.log("✅ 'results' table verified/created");
  } catch (err) {
    console.error('❌ Table setup failed:', err.message);
  }
})();

// ✅ File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// ==================== ROUTES ====================

// 🔐 Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.admin = true;
    res.json({ success: true, message: 'Login successful' });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

// 📤 Admin Upload Result
app.post('/api/admin/upload', upload.single('file'), async (req, res) => {
  if (!req.session.admin) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  const { student_name, exam_number, pin } = req.body;
  const filePath = `/uploads/${req.file.filename}`;

  try {
    const conn = await pool.getConnection();
    await conn.query(
      'INSERT INTO results (student_name, exam_number, pin, file_path) VALUES (?, ?, ?, ?)',
      [student_name, exam_number, pin, filePath]
    );
    conn.release();

    res.json({ success: true, message: 'Result uploaded successfully' });
  } catch (error) {
    console.error('DB Error:', error);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// 🎓 Student Verify Result
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

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
