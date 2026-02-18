import { supabase, isSupabaseConfigured } from "./supabase.js";

const TABLE = "workout_entries";
const KEY_PREFIX = "trackV9_";

function listLocalKeys() {
  return Object.keys(localStorage).filter((k) => k.startsWith(KEY_PREFIX));
}

function parseKey(key) {
  // trackV9_${week}_${day}_${exoId}
  const parts = key.split("_");
  if (parts.length < 4) return null;
  const week = Number.parseInt(parts[1], 10);
  const day = parts[2];
  const exoId = parts.slice(3).join("_");
  if (!Number.isFinite(week) || !day || !exoId) return null;
  return { week, day, exoId };
}

function getLocalPayload(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function upsertPayload({ userId, week, day, exoId, payload }) {
  if (!supabase) return Promise.resolve({ ok: false, reason: "not_configured" });
  const updatedAtMs = toMs(payload?._ts) || Date.now();
  const row = { user_id: userId, week, day, exo_id: exoId, payload, updated_at_ms: updatedAtMs };
  return supabase.from(TABLE).upsert(row, { onConflict: "user_id,week,day,exo_id" });
}

let pending = new Map();
let flushTimer = null;

function scheduleFlush(delayMs = 800) {
  if (flushTimer) return;
  flushTimer = window.setTimeout(() => void flushPending(), delayMs);
}

async function flushPending() {
  flushTimer = null;
  if (pending.size === 0) return;
  const session = await getSession();
  if (!session) return;

  const userId = session.user.id;
  const batch = [...pending.values()];
  pending.clear();

  const results = await Promise.allSettled(batch.map((item) => upsertPayload({ userId, ...item })));
  let hadFailures = false;
  results.forEach((res, idx) => {
    const item = batch[idx];
    const ok = res.status === "fulfilled" && !res.value?.error;
    if (ok) return;
    const attempts = (item.attempts ?? 0) + 1;
    if (attempts >= 3) return;
    pending.set(`${item.week}|${item.day}|${item.exoId}`, { ...item, attempts });
    hadFailures = true;
  });
  if (hadFailures) scheduleFlush(2000);
}

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

export function onAuthChange(handler) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => handler(session));
  return () => data.subscription.unsubscribe();
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function requestLoginEmail(email) {
  if (!isSupabaseConfigured) return { ok: false, reason: "not_configured" };
  try {
    const res = await fetch("/api/send-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      return {
        ok: false,
        reason: body.error || "request_failed",
        details: body.details || body.message || "",
        code: body.code
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: "network_error",
      details: err instanceof Error ? err.message : ""
    };
  }
}

export function normalizeAccountCode(code) {
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 32);
}

export async function loginWithAccountCode(code) {
  if (!supabase) return { ok: false, reason: "not_configured" };
  const normalized = normalizeAccountCode(code);
  const res = await fetch("/api/code-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: normalized })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    return { ok: false, reason: body.error || "invalid_credentials", details: body.details, code: body.code };
  }
  if (!body.session?.access_token || !body.session?.refresh_token) return { ok: false, reason: "bad_session" };

  const { error } = await supabase.auth.setSession({
    access_token: body.session.access_token,
    refresh_token: body.session.refresh_token
  });
  if (error) return { ok: false, reason: error.message || "set_session_failed" };
  return { ok: true };
}

export async function fetchMyAccountCode(accessToken) {
  if (!accessToken) return { ok: false, reason: "missing_token" };
  const res = await fetch("/api/my-code", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) return { ok: false, reason: body.error || "request_failed", details: body.details };
  return { ok: true, email: body.email, code: body.code };
}

export function enqueueUpsert(week, day, exoId, payload) {
  if (!isSupabaseConfigured) return;
  const key = `${week}|${day}|${exoId}`;
  const prev = pending.get(key);
  pending.set(key, { week, day, exoId, payload, attempts: prev?.attempts ?? 0 });
  scheduleFlush();
}

export async function syncCloudToLocal() {
  if (!supabase) return { ok: false, reason: "not_configured" };
  const session = await getSession();
  if (!session) return { ok: false, reason: "not_signed_in" };

  const { data, error } = await supabase.from(TABLE).select("week,day,exo_id,payload,updated_at_ms");
  if (error) return { ok: false, reason: "select_failed", error };
  if (!data) return { ok: true, pulled: 0, updated: 0 };

  let updated = 0;
  for (const row of data) {
    const key = `${KEY_PREFIX}${row.week}_${row.day}_${row.exo_id}`;
    const local = getLocalPayload(key);
    const localTs = toMs(local?._ts);
    const remoteTs = toMs(row.updated_at_ms);
    if (!local || remoteTs >= localTs) {
      const payload = row.payload ?? {};
      payload._ts = remoteTs || Date.now();
      localStorage.setItem(key, JSON.stringify(payload));
      updated++;
    }
  }
  return { ok: true, pulled: data.length, updated };
}

export async function syncLocalToCloud() {
  if (!supabase) return { ok: false, reason: "not_configured" };
  const session = await getSession();
  if (!session) return { ok: false, reason: "not_signed_in" };

  const userId = session.user.id;
  const keys = listLocalKeys();
  const rows = [];
  for (const key of keys) {
    const parsed = parseKey(key);
    if (!parsed) continue;
    const payload = getLocalPayload(key);
    if (!payload) continue;
    const updatedAtMs = toMs(payload._ts) || Date.now();
    rows.push({
      user_id: userId,
      week: parsed.week,
      day: parsed.day,
      exo_id: parsed.exoId,
      payload,
      updated_at_ms: updatedAtMs
    });
  }

  if (rows.length === 0) return { ok: true, pushed: 0 };
  const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: "user_id,week,day,exo_id" });
  if (error) return { ok: false, reason: "upsert_failed", error };
  return { ok: true, pushed: rows.length };
}
