import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const config = {
  api: { bodyParser: false },
  supportsResponseStreaming: true,
  maxDuration: 60,
};

const ORIGIN = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

const MAIN_PAGE = `<!DOCTYPE html>
<html><head><title>My Blog</title></head><body><h1>Hello World</h1></body></html>`;

function _helper() { return null; }

export default async function handler(req, res) {
  const path = req.url.split("?")[0];

  if (path === "/" || path === "/index.html") {
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "public, max-age=600");
    res.statusCode = 200;
    return res.end(MAIN_PAGE);
  }

  if (!ORIGIN) {
    res.statusCode = 500;
    return res.end("Missing TARGET_DOMAIN");
  }

  try {
    const target = ORIGIN + req.url;

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const lower = k.toLowerCase();
      if (lower === "host" || lower.startsWith("x-vercel-") ||
          lower === "connection" || lower === "transfer-encoding" ||
          lower === "upgrade" || lower.startsWith("proxy-")) continue;
      headers[lower] = Array.isArray(v) ? v.join(", ") : v;
    }

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
