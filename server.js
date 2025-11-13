import express from 'express';
import session from 'express-session';
import MySQLStore from 'express-mysql-session';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 10000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ MySQL Connection
const pool = await mysql.createPool(process.env.MYSQL_URL);

// ✅ Session Store
const MySQLSessionStore = MySQLStore(session);
const sessionStore = new MySQLSessionStore({}, pool);

// ✅ Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ CORS Configuration
app.use(
  cors({
    origin: [
      'https://rosainternationalschool.kesug.com',
      'http://rosainternationalschool.kesug.com',
    ],
    credentials: true, // allow cookies
  })
);

// ✅ Session Setup
app.use(
  session({
    key: 'rosa_admin_session',
    secret: process.env.SESSION_SECRET || 'rosaSecretKey',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // true only if HTTPS with SSL
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 2, // 2 hours
    },
  })
);

// ✅ Multer setup for uploads
const upload = multer({ dest: 'uploads/' });

// ✅ Ensure admin table exists
await pool.query(`
  CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL
  )
`);

// ✅ Ensure default admin exists
const [rows] = await pool.query('SELECT * FROM admins WHERE username = ?', ['admin']);
if (rows.length === 0) {
  const hashed = await bcrypt.hash('20145067cq', 10);
  await pool.query('INSERT INTO admins (username, password) VALUES (?, ?)', ['admin', hashed]);
  console.log('✅ Default admin created.');
}

// ✅ Login endpoint
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const [admins] = await pool.query('SELECT * FROM admins WHERE username = ?', [username]);
  if (admins.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

  const admin = admins[0];
  const valid = await bcrypt.compare(password, admin.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  req.session.admin = { id: admin.id, username: admin.username };
  res.json({ message: 'Login successful' });
});

// ✅ Logout endpoint
app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out successfully' }));
});

// ✅ Upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.session.admin) return res.status(401).json({ error: 'Unauthorized' });

  const { studentName, examNumber, pin } = req.body;
  const file = req.file ? req.file.filename : null;

  await pool.query(
    'INSERT INTO results (student_name, exam_number, pin, file_path) VALUES (?, ?, ?, ?)',
    [studentName, examNumber, pin, file]
  );

  res.json({ message: 'Result uploaded successfully' });
});

// ✅ Serve static files (uploads)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ✅ Start server
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
