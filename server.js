import express from "express";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import session from "express-session";
import MySQLStoreImport from "express-mysql-session";
import multer from "multer";
import cors from "cors";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 10000;

// ✅ Connect to Railway MySQL
const pool = mysql.createPool({
  uri: process.env.MYSQL_URL || "mysql://root:TfEdRGUZlwebqUITwnpOBwXxSnusfjlI@crossover.proxy.rlwy.net:37027/railway",
  connectionLimit: 10,
});

// ✅ Initialize database (auto-create tables + admin)
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_name VARCHAR(255) NOT NULL,
        exam_number VARCHAR(100),
        pin VARCHAR(100),
        file_url VARCHAR(255),
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS access_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        exam_number VARCHAR(100),
        pin VARCHAR(100),
        ip_address VARCHAR(100),
        accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const [admins] = await pool.query("SELECT * FROM admin LIMIT 1");
    if (admins.length === 0) {
      const hash = await bcrypt.hash("20145067cq", 10);
      await pool.query("INSERT INTO admin (username, password_hash) VALUES (?, ?)", ["admin", hash]);
      console.log("✅ Default admin created → username: admin | password: 20145067cq");
    } else {
      console.log("✅ Admin table found, skipping seeding.");
    }

    console.log("✅ Database initialization complete.");
  } catch (err) {
    console.error("❌ Database setup error:", err);
  }
}
await initDatabase();

// ✅ Setup session store
const MySQLStore = MySQLStoreImport(session);
const sessionStore = new MySQLStore({}, pool);

app.use(
  session({
    key: "rosa_admin_session",
    secret: process.env.SESSION_SECRET || "rosa_secret_key_2025",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // change to true if Render enforces HTTPS
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 3, // 3 hours
    },
  })
);

// ✅ Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ CORS — allow InfinityFree + local testing
app.use(
  cors({
    origin: [
      "http://127.0.0.1:5500", // local dev
      "https://rosainternationalschool.kesug.com",
      "http://rosainternationalschool.kesug.com",
    ],
    credentials: true,
  })
);

// ✅ File upload setup
const uploadDir = path.resolve("uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage });

// ✅ Middleware: authentication
function requireAuth(req, res, next) {
  if (!req.session.adminId) return res.status(401).json({ success: false, message: "Unauthorized" });
  next();
}

// ✅ Admin login
app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await pool.query("SELECT * FROM admin WHERE username = ?", [username]);
    if (rows.length === 0) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const admin = rows[0];
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: "Invalid credentials" });

    req.session.adminId = admin.id;
    res.json({ success: true, message: "Login successful" });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ Admin logout
app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true, message: "Logged out" }));
});

// ✅ Upload student result
app.post("/api/admin/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const { student_name, exam_number, pin } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: "No file uploaded" });

    const file_url = `/uploads/${file.filename}`;
    await pool.query(
      "INSERT INTO results (student_name, exam_number, pin, file_url) VALUES (?, ?, ?, ?)",
      [student_name, exam_number || null, pin || null, file_url]
    );

    res.json({ success: true, message: "Result uploaded successfully", file_url });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ success: false, message: "Upload failed" });
  }
});

// ✅ Serve uploaded files
app.use("/uploads", express.static(uploadDir));

// ✅ List uploaded results
app.get("/api/admin/list", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM results ORDER BY upload_date DESC LIMIT 20");
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("List error:", err);
    res.status(500).json({ success: false, message: "Failed to load results" });
  }
});

// ✅ Student result lookup
app.post("/api/results/check", async (req, res) => {
  const { examNumber, pin } = req.body;
  try {
    const [rows] = await pool.query("SELECT * FROM results WHERE exam_number = ? AND pin = ?", [examNumber, pin]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: "Result not found" });

    const result = rows[0];
    await pool.query("INSERT INTO access_logs (exam_number, pin, ip_address) VALUES (?, ?, ?)", [
      examNumber,
      pin,
      req.ip,
    ]);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("Result lookup error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ Default route
app.get("/", (req, res) => res.send("Rosa International School API is running ✅"));

// ✅ Start server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
