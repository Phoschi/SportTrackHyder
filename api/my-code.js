import { decryptAccountCode } from "./_crypto.js";
import { supabaseAdmin, supabaseAnon } from "./_supabase.js";
import { json, rateLimit } from "./_util.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "method_not_allowed" });

    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
    if (!token) return json(res, 401, { ok: false, error: "missing_token" });

    const ip =
      (req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",")[0] : null) ||
      req.socket?.remoteAddress ||
      "unknown";
    if (!rateLimit({ key: `mycode:${ip}`, limit: 30, windowMs: 60_000 })) {
      return json(res, 429, { ok: false, error: "rate_limited" });
    }

    const anon = supabaseAnon();
    const { data: userData, error: userErr } = await anon.auth.getUser(token);
    if (userErr || !userData?.user?.email) return json(res, 401, { ok: false, error: "invalid_token" });

    const email = String(userData.user.email).trim().toLowerCase();
    const admin = supabaseAdmin();

    const { data: profile, error: profErr } = await admin
      .from("account_profiles")
      .select("account_code_enc")
      .eq("email", email)
      .maybeSingle();
    if (profErr) return json(res, 500, { ok: false, error: "db_select_failed", details: profErr.message });
    if (!profile?.account_code_enc) return json(res, 404, { ok: false, error: "not_found" });

    const code = decryptAccountCode(profile.account_code_enc);
    return json(res, 200, { ok: true, email, code });
  } catch (err) {
    console.error("my-code: internal error", err);
    return json(res, 500, { ok: false, error: "internal_error" });
  }
}

