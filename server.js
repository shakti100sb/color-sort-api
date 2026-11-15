const express = require("express");
const { Pool } = require("pg");

const dbUrl = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: dbUrl,
  ssl: dbUrl && !dbUrl.includes("localhost") ? { rejectUnauthorized: false } : false
});

const app = express();
app.use(express.json({ limit: "1kb" }));

// Allow the game page (GitHub Pages) to call this API
const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", ORIGIN);
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Basic rate limit: 40 posts per minute per IP
const hits = new Map();
setInterval(() => hits.clear(), 60 * 1000);
function limited(req) {
  const ip = req.headers["x-forwarded-for"] || req.ip;
  const n = (hits.get(ip) || 0) + 1;
  hits.set(ip, n);
  return n > 40;
}

app.get("/", (req, res) => res.send("Color Sort API running"));

app.get("/scores", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT name, score, ms FROM scores ORDER BY score DESC, ms ASC LIMIT 10"
    );
    res.json(rows.map(r => ({ name: r.name, score: r.score, ms: Number(r.ms) })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "db" });
  }
});

app.post("/scores", async (req, res) => {
  if (limited(req)) return res.status(429).json({ error: "slow down" });
  const name = String(req.body.name || "").trim().slice(0, 20);
  const score = req.body.score;
  const ms = req.body.ms;
  if (!name || !Number.isInteger(score) || score < 0 || score > 100000 ||
      !Number.isInteger(ms) || ms < 0 || ms > 7 * 24 * 3600 * 1000) {
    return res.status(400).json({ error: "bad input" });
  }
  try {
    // Only ever keeps a player's best score
    await pool.query(
      `INSERT INTO scores (name, score, ms) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET score = EXCLUDED.score, ms = EXCLUDED.ms, updated = now()
       WHERE EXCLUDED.score > scores.score`,
      [name, score, ms]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "db" });
  }
});

(async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS scores (
       name text PRIMARY KEY,
       score integer NOT NULL,
       ms bigint NOT NULL,
       updated timestamptz NOT NULL DEFAULT now()
     )`
  );
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log("Listening on " + port));
})();
