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
// ✅ Allow your website to connect to this backend
app.use(cors({
  origin: '*', // allows all sites for now (testing)
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 }
}));

// Serve public folder statically
app.use(express.static(path.join(__dirname, 'public')));

// Multer setup
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random()*1e9);
    cb(null, unique + '-' + file.originalname.replace(/\s+/g,'_'));
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 20 * 1024 * 1024 } });

// MySQL pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'rosa_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Utility functions
async function findResultByCredentials(examNumber, pin) {
  const [rows] = await pool.query('SELECT * FROM results WHERE exam_number = ? AND pin = ? LIMIT 1', [examNumber, pin]);
  return rows && rows.length ? rows[0] : null;
}

async function createAccessToken(resultId, ttlSeconds = 300) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await pool.query('INSERT INTO access_tokens (token, result_id, expires_at) VALUES (?, ?, ?)', [token, resultId, expiresAt]);
  return token;
}

async function validateAccessToken(token) {
  const [rows] = await pool.query('SELECT * FROM access_tokens WHERE token = ? LIMIT 1', [token]);
  if (!rows || rows.length === 0) return null;
  const rec = rows[0];
  if (new Date(rec.expires_at) < new Date()) return null;
  return rec;
}

// API: Student verify
app.post('/api/student/verify', async (req, res) => {
  try {
    const { examNumber, pin } = req.body;
    if (!examNumber || !pin) return res.status(400).json({ success: false, message: 'Missing credentials' });
    const result = await findResultByCredentials(examNumber, pin);
    if (!result) return res.status(401).json({ success: false, message: 'Invalid Exam Number or PIN.' });
    // create temporary access token
    const token = await createAccessToken(result.id, 300);
    return res.json({ success: true, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// View result page - token required
app.get('/view-result', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(403).send('Access token required');
    const access = await validateAccessToken(token);
    if (!access) return res.status(403).send('Invalid or expired token');
    const [rows] = await pool.query('SELECT * FROM results WHERE id = ? LIMIT 1', [access.result_id]);
    if (!rows || rows.length === 0) return res.status(404).send('Result not found');
    const result = rows[0];

    // Render a simple HTML that embeds PDF if possible and provides download link
    const filePath = path.resolve(result.file_path);
    const ext = path.extname(filePath).toLowerCase();
    let embedHTML = '';
    if (ext === '.pdf') {
      embedHTML = `<iframe src="/download/${result.id}?token=${token}" style="width:100%;height:80vh;border:0"></iframe>`;
    } else {
      embedHTML = `<p>The uploaded result is available for download below.</p>`;
    }

    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Result for ${result.student_name}</title><link rel="stylesheet" href="/asset/css/styles.css"></head><body><div class="container" style="padding:2rem;max-width:900px;margin:0 auto"> <h1>Result: ${result.student_name}</h1> ${embedHTML} <p style="margin-top:1rem"><a class="btn btn-primary" href="/download/${result.id}?token=${token}">Download Result</a></p> </div></body></html>`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Secure download endpoint
app.get('/download/:id', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(403).send('Access token required');
    const access = await validateAccessToken(token);
    if (!access) return res.status(403).send('Invalid or expired token');
    const id = parseInt(req.params.id, 10);
    if (access.result_id !== id) return res.status(403).send('Token does not permit access to this file');
    const [rows] = await pool.query('SELECT * FROM results WHERE id = ? LIMIT 1', [id]);
    if (!rows || rows.length === 0) return res.status(404).send('File not found');
    const result = rows[0];
    const filePath = path.resolve(result.file_path);
    if (!fs.existsSync(filePath)) return res.status(404).send('File missing');
    res.download(filePath, path.basename(filePath));
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Admin login
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === (process.env.ADMIN_USER || 'admin') && password === (process.env.ADMIN_PASS || '20145067cq')) {
    req.session.admin = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// Middleware to protect admin APIs
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.status(401).json({ success: false, message: 'Unauthorized' });
}

// Admin: list students (paginated)
app.get('/api/admin/list', requireAdmin, async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '30', 10);
  const offset = (page - 1) * limit;
  const [rows] = await pool.query('SELECT id, student_name, exam_number, pin, upload_date FROM results ORDER BY upload_date DESC LIMIT ? OFFSET ?', [limit, offset]);
  res.json({ success: true, data: rows });
});

// Admin: upload result(s)
app.post('/api/admin/upload', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const student_name = req.body.student_name || 'Unknown Student';
    // generate unique exam number and pin
    const exam_number = req.body.exam_number || String(Date.now()).slice(-8);
    const pin = req.body.pin || ('' + Math.floor(100000 + Math.random() * 900000));
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: 'File required' });
    const file_path = file.path;
    const upload_date = new Date();
    const [result] = await pool.query('INSERT INTO results (student_name, exam_number, pin, file_path, upload_date) VALUES (?, ?, ?, ?, ?)', [student_name, exam_number, pin, file_path, upload_date]);
    res.json({ success: true, id: result.insertId, exam_number, pin });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Admin logout
app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// Start server
app.listen(PORT, () => {
  console.log('Server listening on port', PORT);
});


