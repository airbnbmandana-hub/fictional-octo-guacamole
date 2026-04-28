import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const config = {
  api: { bodyParser: false },
  supportsResponseStreaming: true,
  maxDuration: 60,
};

const BACKEND = (process.env.BACKEND_URL || "").replace(/\/$/, "");
const SECRET = process.env.PROXY_PATH || "/api/edge";
const ALLOWED = (process.env.ALLOWED_IPS || "").split(",").filter(Boolean);

const HOME_HTML = `<!DOCTYPE html>
<html><head><title>My Blog</title></head><body><h1>Hello World</h1></body></html>`;

function getIP(req) {
  const fwd = req.headers["x-forwarded-for"];
  return fwd ? fwd.split(",")[0].trim() : req.socket.remoteAddress;
}

export default async function handler(req, res) {
  const url = req.url.split("?")[0];

  if (url === "/" || url === "/index.html") {
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "public, max-age=600");
    res.statusCode = 200;
    return res.end(HOME_HTML);
  }

  if (!url.startsWith(SECRET)) {
    res.statusCode = 404;
    return res.end("Not Found");
  }

  const ip = getIP(req);
  if (ALLOWED.length && !ALLOWED.includes(ip)) {
    res.statusCode = 403;
    return res.end("Forbidden");
  }

  if (!BACKEND) {
    res.statusCode = 500;
    return res.end("Backend missing");
  }

  try {
    const pathAfter = req.url.slice(SECRET.length) || "/";
    const target = BACKEND + pathAfter;

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const lower = k.toLowerCase();
      if (lower === "host" || lower.startsWith("x-vercel-") ||
          lower === "connection" || lower === "transfer-encoding" ||
          lower === "upgrade" || lower === "proxy-") continue;
      headers[lower] = Array.isArray(v) ? v.join(", ") : v;
    }
    headers["x-forwarded-for"] = ip;

    const fetchOpts = { method: req.method, headers, redirect: "manual" };
    if (req.method !== "GET" && req.method !== "HEAD") {
      fetchOpts.body = Readable.toWeb(req);
      fetchOpts.duplex = "half";
    }

    const upstream = await fetch(target, fetchOpts);
    res.statusCode = upstream.status;
    for (const [k, v] of upstream.headers) {
      if (k.toLowerCase() === "transfer-encoding") continue;
      try { res.setHeader(k, v); } catch {}
    }

    if (upstream.body) {
      await pipeline(Readable.fromWeb(upstream.body), res);
    } else {
      res.end();
    }
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.end("Bad Gateway");
    }
  }
}
