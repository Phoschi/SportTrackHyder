import crypto from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateAccountCode(length = 12) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  // format: XXXX-XXXX-XXXX for readability
  return out.replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

export function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function getEncKey() {
  const raw = process.env.ACCOUNT_CODE_ENC_KEY || "";
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) return null;
  return buf;
}

export function encryptAccountCode(plain) {
  const key = getEncKey();
  if (!key) throw new Error("ACCOUNT_CODE_ENC_KEY must be base64(32 bytes)");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${ciphertext.toString("base64")}.${tag.toString("base64")}`;
}

export function decryptAccountCode(enc) {
  const key = getEncKey();
  if (!key) throw new Error("ACCOUNT_CODE_ENC_KEY must be base64(32 bytes)");
  const [ivB64, ctB64, tagB64] = String(enc || "").split(".");
  if (!ivB64 || !ctB64 || !tagB64) throw new Error("Bad encrypted payload");
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}

