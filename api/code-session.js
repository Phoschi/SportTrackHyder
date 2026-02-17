import { supabaseAdmin, supabaseAnon } from "./_supabase.js";
import { decryptAccountCode, sha256Hex } from "./_crypto.js";
import { getAppOrigin, json, normalizeAccountCode, rateLimit, readJson } from "./_util.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });

    const origin = getAppOrigin();
    if (!origin) return json(res, 500, { ok: false, error: "missing_app_origin" });

    const ip =
      (req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",")[0] : null) ||
      req.socket?.remoteAddress ||
      "unknown";
    if (!rateLimit({ key: `code:${ip}`, limit: 15, windowMs: 60_000 })) {
      return json(res, 429, { ok: false, error: "rate_limited" });
    }

    const body = await readJson(req);
    const codeRaw = normalizeAccountCode(body.code);
    if (!codeRaw || codeRaw.length < 8) return json(res, 400, { ok: false, error: "invalid_code" });

    const codeHash = sha256Hex(codeRaw);
    const admin = supabaseAdmin();
    const anon = supabaseAnon();

    const { data: profile, error: profErr } = await admin
      .from("account_profiles")
      .select("email,account_code_enc")
      .eq("account_code_hash", codeHash)
      .maybeSingle();
    if (profErr) return json(res, 500, { ok: false, error: "db_select_failed" });
    if (!profile?.email) return json(res, 401, { ok: false, error: "invalid_credentials" });

    // Optional hardening: ensure the encrypted code matches the hash (detect corruption)
    try {
      const decrypted = decryptAccountCode(profile.account_code_enc);
      const normalized = normalizeAccountCode(decrypted);
      if (sha256Hex(normalized) !== codeHash) return json(res, 401, { ok: false, error: "invalid_credentials" });
    } catch {
      return json(res, 500, { ok: false, error: "code_decrypt_failed" });
    }

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: profile.email,
      options: { redirectTo: origin }
    });
    if (linkErr || !linkData?.properties?.email_otp || !linkData?.properties?.verification_type) {
      return json(res, 500, { ok: false, error: "link_generate_failed", message: linkErr?.message });
    }

    const token = linkData.properties.email_otp;
    const type = linkData.properties.verification_type;

    const { data: sessionData, error: verifyErr } = await anon.auth.verifyOtp({
      email: profile.email,
      token,
      type
    });
    if (verifyErr || !sessionData?.session) {
      return json(res, 500, { ok: false, error: "verify_failed", message: verifyErr?.message });
    }

    const { access_token, refresh_token, expires_in, expires_at, token_type } = sessionData.session;
    return json(res, 200, {
      ok: true,
      session: { access_token, refresh_token, expires_in, expires_at, token_type }
    });
  } catch (err) {
    return json(res, 500, { ok: false, error: "internal_error" });
  }
}
