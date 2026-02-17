import { supabase } from "./supabase.js";
import { cloneDefaultProgram } from "./defaultProgram.js";

const TABLE = "workout_programs";
const LOCAL_KEY = "trackV9_program_v1";

export function loadCachedProgram() {
  const raw = localStorage.getItem(LOCAL_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.program) return null;
    const updatedAtMsRaw = parsed.updatedAtMs;
    const updatedAtMs =
      typeof updatedAtMsRaw === "number"
        ? updatedAtMsRaw
        : Number.parseInt(typeof updatedAtMsRaw === "string" ? updatedAtMsRaw : "", 10);
    if (!Number.isFinite(updatedAtMs)) return null;
    return { program: parsed.program, updatedAtMs };
  } catch {
    return null;
  }
}

export function cacheProgram(program, updatedAtMs) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ program, updatedAtMs }));
}

export function ensureProgramShape(program) {
  if (!program || typeof program !== "object") return cloneDefaultProgram();
  const weeks = program.weeks && typeof program.weeks === "object" ? program.weeks : null;
  if (!weeks || !weeks.odd || !weeks.even) return cloneDefaultProgram();
  return program;
}

export async function fetchProgramFromCloud(userId) {
  if (!supabase) return { ok: false, reason: "not_configured" };
  const { data, error } = await supabase
    .from(TABLE)
    .select("program,updated_at_ms")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, reason: "select_failed", details: error.message };
  if (!data) return { ok: false, reason: "not_found" };
  const updatedAtMsRaw = data.updated_at_ms;
  const updatedAtMs =
    typeof updatedAtMsRaw === "number" ? updatedAtMsRaw : Number.parseInt(String(updatedAtMsRaw || 0), 10) || 0;
  return { ok: true, program: data.program, updatedAtMs };
}

export async function upsertProgramToCloud(userId, program, updatedAtMs) {
  if (!supabase) return { ok: false, reason: "not_configured" };
  const row = { user_id: userId, program, updated_at_ms: updatedAtMs };
  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: "user_id" });
  if (error) return { ok: false, reason: "upsert_failed", details: error.message };
  return { ok: true };
}
