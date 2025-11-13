require('dotenv').config();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const session = require('express-session');

const PORT = process.env.PORT || 10000;
const UPLOAD_DIR = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const app = express();

// ✅ CORS setup (replace YOUR_DOMAIN below with your actual InfinityFree URL)
app.use(cors({
  origin: [
    'https://rosainternationalschool.kesug.com', // your frontend domain
    'http://rosainternationalschool.kesug.com'
  ],
  credentials: true,
}));

// ✅ Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Sessions with cookies that work cross-domain
app.use(session({
  secret: process.env.SESSION_SECRET || 'rosa_secret_2025',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true, // required on HTTPS (Render + InfinityFree are HTTPS)
    sameSite: 'none', // allow cross-site cookies
    maxAge: 1000 * 60 * 60, // 1 hour
  }
}));

// ✅ Serve static files & uploads
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ✅ MySQL connection (Railway)
const pool = mysql.createPool({
  uri: process.env.DATABASE_URL || 'mysql://root:TfEdRGUZlwebqUITwnpOBwXxSnusfjlI@crossover.proxy.rlwy.net:37027/railway',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// ✅ Verify table on startup
(async () => {
  try {
    const conn = await pool.getConnection();
    await conn.query(`
      CREATE TABLE IF NOT EXISTS results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_name VARCHAR(255) NOT NULL,
        exam_number VARCHAR(100),
        pin VARCHAR(50),
        file_path VARCHAR(500),
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    conn.release();
    console.log('✅ "results" table verified/created');
  } catch (err) {
    console.error('❌ Database table check failed:', err.message);
  }
})();

// ✅ Multer storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// =============== ROUTES ===============

// 🧑‍💻 Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (
    username === (process.env.ADMIN_USER || 'admin') &&
    password === (process.env.ADMIN_PASS || '20145067cq')
  ) {
    req.session.admin = true;
    return res.json({ success: true, message: 'Login successful' });
  }
  return res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// 🧑‍💻 Admin Logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
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
  } catch (err) {
    console.error('DB Insert Error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// 📋 List uploaded results
app.get('/api/admin/list', async (req, res) => {
  if (!req.session.admin) return res.status(403).json({ success: false, message: 'Unauthorized' });
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT * FROM results ORDER BY upload_date DESC LIMIT 20');
    conn.release();
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// 🎓 Student result lookup
app.post('/api/student/verify', async (req, res) => {
  const { examNumber, pin } = req.body;
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query(
      'SELECT * FROM results WHERE exam_number = ? AND pin = ?',
      [examNumber, pin]
    );
    conn.release();
    if (rows.length > 0) res.json({ success: true, result: rows[0] });
    else res.status(404).json({ success: false, message: 'No result found' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
