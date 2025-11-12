require('dotenv').config();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const session = require('express-session');

const app = express();

// ==========================
// 🔧 Configuration
// ==========================
const PORT = process.env.PORT || 10000;
const UPLOAD_DIR = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// ==========================
// 🌍 CORS (Frontend Connection)
// ==========================
app.use(cors({
  origin: 'https://rosainternationalschool.kesug.com', // your InfinityFree frontend
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================
// 💾 Sessions
// ==========================
app.use(session({
  secret: process.env.SESSION_SECRET || 'rosa_secret_key_2025',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // true only if using HTTPS directly
    httpOnly: true,
    maxAge: 1000 * 60 * 60 // 1 hour
  }
}));

// ==========================
// 🧱 Static Files
// ==========================
app.use('/uploads', express.static(UPLOAD_DIR));

// ==========================
// 🛢️ Database (Railway MySQL)
// ==========================
const pool = mysql.createPool({
  host: process.env.DB_HOST,        // mysql.railway.internal
  user: process.env.DB_USER,        // root
  password: process.env.DB_PASS,    // your Railway password
  database: process.env.DB_NAME,    // railway
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10
});

// ==========================
// 📤 File Upload Setup (Multer)
// ==========================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});
const upload = multer({ storage });

// ==========================
// 🧑‍💻 Admin Login
// ==========================
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.admin = true;
    return res.json({ success: true, message: 'Login successful' });
  }

  res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// ==========================
// 📁 Upload Student Result
// ==========================
app.post('/api/admin/upload', upload.single('file'), async (req, res) => {
  if (!req.session.admin) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  const { student_name, exam_number, pin } = req.body;
  const filePath = `/uploads/${req.file.filename}`;

  try {
    const conn = await pool.getConnection();

    const query = `
      INSERT INTO results (student_name, exam_number, pin, file_path, upload_date)
      VALUES (?, ?, ?, ?, NOW())
    `;
    await conn.query(query, [student_name, exam_number, pin, filePath]);
    conn.release();

    res.json({ success: true, message: 'Result uploaded successfully' });
  } catch (error) {
    console.error('❌ Database Error:', error);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==========================
// 🎓 Student Result Lookup
// ==========================
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
    console.error('❌ Database Error:', error);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==========================
// 🧾 Default Route
// ==========================
app.get('/', (req, res) => {
  res.send('✅ Rosa International School Server Running Successfully!');
});

// ==========================
// 🚀 Start Server
// ==========================
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
