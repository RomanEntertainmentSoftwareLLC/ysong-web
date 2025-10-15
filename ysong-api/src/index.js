import express from "express";
import cors from "cors";
import crypto from "crypto";
import argon2 from "argon2";
import { z } from "zod";
import { pool } from "./db.js";
import { sendVerifyEmail } from "./email.js";

const app = express();
app.use(express.json());
app.use(cors({
  origin: ["http://localhost:5173", /\.vercel\.app$/], // add your Vercel domain later
  credentials: false
}));

// Health check
app.get("/healthz/db", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: "db" });
  }
});

// Helpers
const SignupSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200)
});

function sha256(hexOrBuffer) {
  return crypto.createHash("sha256").update(hexOrBuffer).digest("hex");
}

function minutesFromNow(mins) {
  return new Date(Date.now() + mins * 60_000);
}

// POST /auth/signup
app.post("/auth/signup", async (req, res) => {
  try {
    const { email, password } = SignupSchema.parse(req.body);
    const normalized = email.trim().toLowerCase();
    const password_hash = await argon2.hash(password, { type: argon2.argon2id });

    // upsert user (insert or keep existing)
    const user = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET updated_at = now()
       RETURNING id, email`,
      [normalized, password_hash]
    );

    const user_id = user.rows[0].id;

    // create one-time token
    const raw = crypto.randomBytes(32).toString("hex");
    const token_hash = sha256(raw);
    const expires_at = minutesFromNow(30);

    await pool.query(
      `INSERT INTO email_verifications (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user_id, token_hash, expires_at]
    );

    await sendVerifyEmail(normalized, raw);

    // Generic response (don’t leak existence)
    res.json({ message: "If an account exists, check your email for a verification link." });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "invalid_request" });
  }
});

// GET /auth/verify?token=...&email=...
app.get("/auth/verify", async (req, res) => {
  const token = String(req.query.token || "");
  const email = String(req.query.email || "").trim().toLowerCase();
  if (!token || !email) return res.status(400).json({ error: "missing_params" });

  const token_hash = sha256(token);

  try {
    const { rows } = await pool.query(
      `SELECT ev.id, u.id as user_id
         FROM email_verifications ev
         JOIN users u ON u.id = ev.user_id
        WHERE u.email = $1
          AND ev.token_hash = $2
          AND ev.consumed_at IS NULL
          AND ev.expires_at > now()
        LIMIT 1`,
      [email, token_hash]
    );

    if (rows.length === 0) {
      return res.status(400).json({ ok: false, reason: "invalid_or_expired" });
    }

    const { user_id, id: ev_id } = rows[0];

    await pool.query("UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1", [user_id]);
    await pool.query("UPDATE email_verifications SET consumed_at = now() WHERE id = $1", [ev_id]);

    // You can redirect to a “verified” page on your frontend:
    // return res.redirect(302, `${process.env.APP_URL}/verified`);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`YSong API listening on ${port}`));
