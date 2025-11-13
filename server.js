require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const session = require('express-session');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// ✅ Ensure uploads directory exists
const UPLOAD_DIR = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// ✅ Allow your InfinityFree frontend
app.use(cors({
  origin: 'https://rosainternationalschool.kesug.com',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// ✅ Parse JSON and form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Serve uploaded files
app.use('/uploads', express.static(UPLOAD_DIR));

// ✅ Session setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'rosa_international_secret_2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 60 * 60 * 1000 }
}));

// ✅ Database Connection
let pool;
(async () => {
  try {
    pool = await mysql.createPool({
      host: process.env.DB_HOST || 'crossover.proxy.rlwy.net',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || 'TfEdRGUZlwebqUITwnpOBwXxSnusfjlI',
      database: process.env.DB_NAME || 'railway',
      port: process.env.DB_PORT || 37027,
      waitForConnections: true,
      connectionLimit: 10
    });

    // ✅ Auto create table if it doesn’t exist
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_name VARCHAR(255) NOT NULL,
        exam_number VARCHAR(100) NOT NULL,
        pin VARCHAR(50) NOT NULL,
        file_path VARCHAR(255),
        upload_date DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `;
    const conn = await pool.getConnection();
    await conn.query(createTableSQL);
    conn.release();

    console.log('✅ Connected to MySQL Database');
    console.log('✅ "results" table verified/created');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
  }
})();

// ✅ File Upload Setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// ================= ROUTES =================

// 🧑‍💻 Admin Login
app.post('/api/admin/login', (req, res) => {
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
  } catch (err) {
    console.error('DB Error:', err);
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
  } catch (err) {
    console.error('DB Error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ✅ Default route
app.get('/', (req, res) => {
  res.send('Rosa International School API is running 🚀');
});

// ================= START SERVER =================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('🌍 Your service is live 🎉');
});
