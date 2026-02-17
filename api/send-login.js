import { decryptAccountCode, encryptAccountCode, generateAccountCode, sha256Hex } from "./_crypto.js";
import { supabaseAdmin, supabaseAnon } from "./_supabase.js";
import { getAppOrigin, isValidEmail, json, rateLimit, readJson } from "./_util.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });

    const origin = getAppOrigin();
    if (!origin) return json(res, 500, { ok: false, error: "missing_app_origin" });

    const ip =
      (req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",")[0] : null) ||
      req.socket?.remoteAddress ||
      "unknown";
    if (!rateLimit({ key: `send:${ip}`, limit: 8, windowMs: 60_000 })) {
      return json(res, 429, { ok: false, error: "rate_limited" });
    }

    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    if (!isValidEmail(email)) return json(res, 400, { ok: false, error: "invalid_email" });

    const admin = supabaseAdmin();
    const anon = supabaseAnon();

    // Get or create account profile
    const { data: existing, error: selectErr } = await admin
      .from("account_profiles")
      .select("email,account_code_enc")
      .eq("email", email)
      .maybeSingle();
    if (selectErr) return json(res, 500, { ok: false, error: "db_select_failed" });

    let isNew = false;
    let accountCode = null;

    if (existing?.account_code_enc) {
      try {
        accountCode = decryptAccountCode(existing.account_code_enc);
      } catch {
        // fallback: rotate code if decrypt fails
        isNew = true;
      }
    } else {
      isNew = true;
    }

    if (!accountCode) {
      const newCode = generateAccountCode(12);
      const normalized = newCode.replace(/[^A-Z0-9]/g, "");
      const codeHash = sha256Hex(normalized);
      const codeEnc = encryptAccountCode(newCode);

      const { error: upsertErr } = await admin.from("account_profiles").upsert(
        {
          email,
          account_code_hash: codeHash,
          account_code_enc: codeEnc
        },
        { onConflict: "email" }
      );
      if (upsertErr) return json(res, 500, { ok: false, error: "db_upsert_failed" });
      accountCode = newCode;

      // Ensure an auth user exists so the workout_entries RLS works once logged in
      await admin.auth.admin.createUser({ email, email_confirm: true });
    }

    const redirectTo = `${origin}/?account=${encodeURIComponent(accountCode)}`;

    const { error: otpErr } = await anon.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
        data: { account_code: accountCode, is_new: isNew }
      }
    });
    if (otpErr) return json(res, 500, { ok: false, error: "otp_send_failed", message: otpErr.message });

    return json(res, 200, { ok: true });
  } catch (err) {
    console.error("send-login: internal error", err);
    return json(res, 500, { ok: false, error: "internal_error", details: "Check Vercel env vars and Supabase logs" });
  }
}
