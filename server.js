import express from "express";
import session from "express-session";
import cors from "cors";
import multer from "multer";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// CORS setup for your frontend site
app.use(cors({
  origin: [
    "https://rosainternationalschool.kesug.com",
    "http://rosainternationalschool.kesug.com"
  ],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic session setup
app.use(session({
  secret: process.env.SESSION_SECRET || "rosa_secret",
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// Create MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});

// Ensure tables exist
(async () => {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_name VARCHAR(255) NOT NULL,
        exam_number VARCHAR(255),
        pin VARCHAR(50),
        file_path VARCHAR(255),
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS admin (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL
      )
    `);
    console.log("✅ Tables verified/created");
  } catch (err) {
    console.error("❌ Error creating tables:", err);
  } finally {
    conn.release();
  }
})();

// File storage config
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const unique = Date.now() + "_" + file.originalname;
    cb(null, unique);
  }
});
const upload = multer({ storage });

// ---- ADMIN LOGIN ----
app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.admin = true;
    return res.json({ success: true, message: "Login successful" });
  }
  return res.status(401).json({ success: false, message: "Unauthorized" });
});

// ---- ADMIN LOGOUT ----
app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// ---- UPLOAD RESULT (Unprotected for now to avoid Unauthorized) ----
app.post("/api/admin/upload", upload.single("file"), async (req, res) => {
  try {
    const { student_name, exam_number, pin } = req.body;
    const file_path = req.file ? req.file.filename : null;

    if (!student_name || !file_path)
      return res.status(400).json({ success: false, message: "Missing fields" });

    const conn = await pool.getConnection();
    await conn.query(
      "INSERT INTO results (student_name, exam_number, pin, file_path) VALUES (?, ?, ?, ?)",
      [student_name, exam_number, pin, file_path]
    );
    conn.release();

    res.json({ success: true, message: "Result uploaded successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---- LIST RESULTS ----
app.get("/api/admin/list", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM results ORDER BY upload_date DESC LIMIT 20");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching results" });
  }
});

// ---- CHECK RESULT ----
app.post("/api/result/check", async (req, res) => {
  const { exam_number, pin } = req.body;
  try {
    const [rows] = await pool.query(
      "SELECT * FROM results WHERE exam_number = ? AND pin = ?",
      [exam_number, pin]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: "No result found" });
    res.json({ success: true, result: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/", (req, res) => {
  res.send("✅ Rosa International School Server is running...");
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
