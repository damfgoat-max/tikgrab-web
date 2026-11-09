// TikGrab — server-side resolver. Browser never talks to tikwm directly;
// this same-origin function does, so iOS Safari can't block it.

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function extractTikTokUrl(input) {
  if (!input) return null;
  const text = String(input);
  // Find the first tiktok-ish URL anywhere in the pasted text, keep its FULL path.
  const m = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (m) {
    let u = m[0].replace(/[)\].,;!?]+$/, "");
    if (/tiktok/i.test(u)) return u;
  }
  // Maybe they pasted a bare domain without scheme
  const bare = text.match(/(?:www\.|vm\.|vt\.|m\.)?tiktok\.com\/[^\s"'<>]+/i);
  if (bare) return "https://" + bare[0].replace(/[)\].,;!?]+$/, "");
  // Fallback: if the whole input looks like a URL, use it as-is
  const trimmed = text.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed.split(/\s/)[0];
  return null;
}

async function fetchTikwm(url) {
  const api = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(api, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw new Error(`Upstream HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Upstream fetch failed");
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  const raw = (req.query && req.query.url) || "";
  const url = extractTikTokUrl(raw);
  if (!url) {
    return res
      .status(400)
      .json({ error: "No TikTok link found in what you pasted. Copy the link from TikTok's Share button and try again." });
  }

  let json;
  try {
    json = await fetchTikwm(url);
  } catch (e) {
    return res
      .status(502)
      .json({ error: `Could not reach the download server (${e && e.message ? e.message : e}). Try again in a few seconds.` });
  }

  if (!json || json.code !== 0 || !json.data) {
    const msg = (json && json.msg) || "That video could not be loaded — it may be private or deleted.";
    return res.status(422).json({ error: String(msg) });
  }

  const d = json.data;
  const author = d.author || {};
  return res.status(200).json({
    id: d.id || null,
    title: d.title || "",
    cover: d.cover || d.origin_cover || null,
    author: {
      nickname: author.nickname || "",
      unique_id: author.unique_id || "",
    },
    duration: d.duration || 0,
    play: d.play || null,
    hdplay: d.hdplay || null,
    wmplay: d.wmplay || null,
    music: d.music || null,
    images: Array.isArray(d.images) && d.images.length ? d.images : null,
  });
};
