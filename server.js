require('dotenv').config();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const session = require('express-session');

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const app = express();

app.use(cors({
  origin: 'https://rosainternationalschool.kesug.com',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'secret_key',
  resave: false,
  saveUninitialized: false
}));

// ✅ Connect to Railway MySQL using DATABASE_URL
const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// ===== ROUTES =====

// Admin login
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASS
  ) {
    req.session.admin = true;
    return res.json({ success: true, message: 'Login successful' });
  }
  return res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// Upload result
app.post('/api/admin/upload', upload.single('file'), async (req, res) => {
  if (!req.session.admin)
    return res.status(403).json({ success: false, message: 'Unauthorized' });

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
  } catch (err) {
    console.error('DB Error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// Student verify
app.post('/api/student/verify', async (req, res) => {
  const { examNumber, pin } = req.body;
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query(
      'SELECT * FROM results WHERE exam_number = ? AND pin = ?',
      [examNumber, pin]
    );
    conn.release();
    if (rows.length) return res.json({ success: true, result: rows[0] });
    res.status(404).json({ success: false, message: 'No result found' });
  } catch (err) {
    console.error('DB Error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
