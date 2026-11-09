// TikGrab — streaming download proxy.
// Only TikTok CDN hosts are allowed. Suffix match on the registrable domain
// so subdomains like v19-notes.tiktokcdn-us.com pass.

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const ALLOWED = [
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "muscdn.com",
  "tikwm.com",
  "ttcdn-us.com",
  "byteoversea.com",
  "ibytedtos.com",
  "pstatp.com",
  "tiktok.com",
];

function hostAllowed(hostname) {
  const h = String(hostname || "").toLowerCase();
  return ALLOWED.some((d) => h === d || h.endsWith("." + d));
}

function sanitizeName(name, fallback) {
  const clean = String(name || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .slice(0, 120)
    .trim();
  return clean || fallback;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  const target = (req.query && req.query.url) || "";
  const inline = req.query && (req.query.inline === "1" || req.query.inline === "true");

  let u;
  try {
    u = new URL(target);
  } catch (_) {
    res.statusCode = 400;
    return res.end("Bad url");
  }
  if (!/^https?:$/.test(u.protocol) || !hostAllowed(u.hostname)) {
    res.statusCode = 403;
    return res.end("Host not allowed");
  }

  const headers = { "User-Agent": UA, Referer: "https://www.tikwm.com/" };
  if (req.headers.range) headers.Range = req.headers.range;

  let upstream;
  try {
    upstream = await fetch(u.toString(), {
      headers,
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    res.statusCode = 502;
    return res.end("Upstream fetch failed: " + (e && e.message ? e.message : e));
  }

  if (!upstream.ok && upstream.status !== 206) {
    res.statusCode = upstream.status;
    return res.end("Upstream returned " + upstream.status);
  }

  const ct = upstream.headers.get("content-type") || "application/octet-stream";
  res.statusCode = upstream.status;
  res.setHeader("Content-Type", ct);
  const len = upstream.headers.get("content-length");
  if (len) res.setHeader("Content-Length", len);
  const cr = upstream.headers.get("content-range");
  if (cr) res.setHeader("Content-Range", cr);
  res.setHeader("Accept-Ranges", "bytes");

  const fallbackExt = ct.includes("audio") || ct.includes("mpeg") ? "tikgrab.mp3" : "tikgrab.mp4";
  const name = sanitizeName(req.query && req.query.name, fallbackExt);
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${name.replace(/"/g, "")}"`
  );

  if (!upstream.body) return res.end();

  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch (_) {
    // client disconnected or upstream cut — just close
  }
  res.end();
};
