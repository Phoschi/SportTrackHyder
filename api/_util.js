export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function isValidEmail(email) {
  if (typeof email !== "string") return false;
  const value = email.trim().toLowerCase();
  if (value.length < 5 || value.length > 254) return false;
  // "good enough" validation for a hobby project
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function normalizeAccountCode(code) {
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 32);
}

export function getAppOrigin() {
  const origin = process.env.APP_ORIGIN?.trim();
  if (!origin) return null;
  try {
    // validate
    // eslint-disable-next-line no-new
    new URL(origin);
    return origin.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

const buckets = new Map();
export function rateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  const bucket = buckets.get(key) ?? [];
  const fresh = bucket.filter((t) => now - t < windowMs);
  fresh.push(now);
  buckets.set(key, fresh);
  return fresh.length <= limit;
}

