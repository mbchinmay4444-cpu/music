// server.js  — Spotify search proxy for web-link cards
// Node 18+ recommended (has global fetch). Keep your CLIENT SECRET on the server only.

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

// ---------- Config ----------
const PORT = process.env.PORT || 8080;
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";
const DEFAULT_MARKET = process.env.SPOTIFY_MARKET || "IN"; // change if you want

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn(
    "[WARN] Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env"
  );
}

app.use(cors());
app.use(express.json());

// ---------- Token cache ----------
let tokenCache = { access_token: null, expires_at: 0 };

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.access_token && now < tokenCache.expires_at - 10_000) {
    return tokenCache.access_token;
  }
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await r.json();
  if (!r.ok) {
    console.error("[Spotify Token Error]", data);
    throw new Error(`Spotify token failed: ${data.error || r.status}`);
  }
  tokenCache.access_token = data.access_token;
  tokenCache.expires_at = Date.now() + data.expires_in * 1000; // seconds → ms
  return tokenCache.access_token;
}

// ---------- Helpers ----------
const LANG_HINT = {
  hindi: "Hindi song",
  english: "English song",
  kannada: "Kannada song",
  tamil: "Tamil song",
  telugu: "Telugu song",
};

function buildQuery(q, lang) {
  const hint = LANG_HINT[(lang || "").toLowerCase()] || "";
  return [q, hint].filter(Boolean).join(" ").trim();
}

function mapTrack(t) {
  return {
    id: t.id,
    title: t.name,
    artists: t.artists?.map((a) => a.name).join(", ") || "",
    album: t.album?.name || "",
    image:
      (t.album?.images && t.album.images[0]?.url) ||
      (t.album?.images && t.album.images[1]?.url) ||
      (t.album?.images && t.album.images[2]?.url) ||
      "",
    url: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
    duration_ms: t.duration_ms,
    explicit: !!t.explicit,
    preview_url: t.preview_url || null, // 30s preview (optional, not needed for your use)
  };
}

// ---------- Routes ----------
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    market: DEFAULT_MARKET,
    token_cached: !!tokenCache.access_token,
  });
});

app.get("/api/search", async (req, res) => {
  try {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return res
        .status(500)
        .json({ error: "Server missing Spotify credentials (.env)" });
    }

    const qRaw = (req.query.q || "").toString().trim();
    if (!qRaw) {
      return res.status(400).json({ error: "Missing query parameter: q" });
    }

    const lang = (req.query.lang || "english").toString();
    const market = (req.query.market || DEFAULT_MARKET).toString();
    const limit = Math.min(Math.max(parseInt(req.query.limit || "24", 10), 1), 50);

    const q = buildQuery(qRaw, lang);
    const token = await getAccessToken();

    const params = new URLSearchParams({
      q,
      type: "track",
      market,
      limit: String(limit),
    });

    const r = await fetch(`https://api.spotify.com/v1/search?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json();

    if (!r.ok) {
      console.error("[Spotify Search Error]", data);
      return res.status(r.status).json({
        error: data?.error?.message || data?.error || "Spotify search failed",
        details: data,
      });
    }

    const items = data.tracks?.items || [];
    const results = items.map(mapTrack);

    res.json({ query: q, results });
  } catch (err) {
    console.error("[Server Error]", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
});

// ---------- Start ----------
app.listen(PORT, () =>
  console.log(`API running → http://localhost:${PORT}`)
);
