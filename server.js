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

// ✅ CORS: Allow your InfinityFree frontend
app.use(cors({
  origin: 'https://rosainternationalschool.kesug.com', // your InfinityFree URL
  methods: ['GET', 'POST'],
  credentials: true,
}));

// ✅ Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'rosa_international_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 } // 1 hour
}));

// ✅ Serve static files
app.use('/uploads', express.static(UPLOAD_DIR));

// ✅ MySQL connection pool
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
      connectionLimit: 10,
      queueLimit: 0,
    });

    console.log('✅ Connected to MySQL Database');

    // 🛠️ Auto-create tables
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

    await conn.query(`
      CREATE TABLE IF NOT EXISTS access_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        action VARCHAR(255),
        ip_address VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    conn.release();
    console.log('✅ Tables verified/created');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
  }
})();

// ✅ File upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// ✅ Admin login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.admin = true;
    return res.json({ success: true, message: 'Login successful' });
  }
  res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// ✅ Admin upload result
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

// ✅ List results
app.get('/api/admin/list', async (req, res) => {
  if (!req.session.admin) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT * FROM results ORDER BY upload_date DESC LIMIT 20');
    conn.release();
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('DB Error:', error);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ✅ Student verify
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

// ✅ Logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'Logged out' });
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
