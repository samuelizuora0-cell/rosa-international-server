import express from "express";
import session from "express-session";
import cors from "cors";
import multer from "multer";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// === CORS for your site ===
app.use(cors({
  origin: [
    "https://rosainternationalschool.kesug.com",
    "http://rosainternationalschool.kesug.com"
  ],
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === Session setup ===
app.use(session({
  secret: process.env.SESSION_SECRET || "rosa_secret_key",
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// === Serve uploaded files ===
app.use("/uploads", express.static("uploads"));

// === Ensure uploads folder exists ===
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

// === MySQL connection ===
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

// === Auto-create required tables ===
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
    console.log("✅ Tables verified or created");
  } catch (err) {
    console.error("❌ Error creating tables:", err);
  } finally {
    conn.release();
  }
})();

// === Multer file storage ===
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "_" + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// =======================================
// =========== ADMIN ROUTES ==============
// =======================================

// ---- Admin Login ----
app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.admin = true;
    return res.json({ success: true, message: "Login successful" });
  }
  return res.status(401).json({ success: false, message: "Unauthorized" });
});

// ---- Admin Logout ----
app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ---- Upload Result (currently unprotected for easy testing) ----
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

    res.json({ success: true, message: "✅ Result uploaded successfully" });
  } catch (err) {
    console.error("❌ Upload Error:", err);
    res.status(500).json({ success: false, message: "Server error during upload" });
  }
});

// ---- List Recent Uploads ----
app.get("/api/admin/list", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM results ORDER BY upload_date DESC LIMIT 20");
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching results" });
  }
});

// =======================================
// ========== STUDENT ROUTES =============
// =======================================

// ---- Student Result Lookup ----
app.post("/api/results/view", async (req, res) => {
  const { exam_number, pin } = req.body;

  if (!exam_number || !pin) {
    return res.status(400).json({ success: false, message: "Exam number and PIN required" });
  }

  try {
    const [rows] = await pool.query(
      "SELECT student_name, exam_number, pin, file_path, upload_date FROM results WHERE exam_number = ? AND pin = ? LIMIT 1",
      [exam_number, pin]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "No result found for provided credentials." });
    }

    const result = rows[0];
    return res.json({
      success: true,
      data: {
        student_name: result.student_name,
        exam_number: result.exam_number,
        file_url: `${req.protocol}://${req.get("host")}/uploads/${result.file_path}`,
        upload_date: result.upload_date
      }
    });
  } catch (err) {
    console.error("❌ Error fetching result:", err);
    res.status(500).json({ success: false, message: "Server error while fetching result." });
  }
});

// ---- Root Check ----
app.get("/", (req, res) => {
  res.send("✅ Rosa International School Server is Live and Running!");
});

// =======================================
// ========== START SERVER ===============
// =======================================
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
