import Chart from "chart.js/auto";
import {
  getSession,
  onAuthChange,
  requestLoginEmail,
  loginWithAccountCode,
  normalizeAccountCode,
  fetchMyAccountCode,
  signOut,
  enqueueUpsert,
  syncCloudToLocal,
  syncLocalToCloud
} from "./cloudSync.js";
import { isSupabaseConfigured } from "./supabase.js";
import { DEFAULT_PROGRAM, cloneDefaultProgram } from "./defaultProgram.js";
import {
  cacheProgram,
  ensureProgramShape,
  fetchProgramFromCloud,
  loadCachedProgram,
  upsertProgramToCloud
} from "./programSync.js";

let currentWeek = 1;
let currentSection = "lundi";
let weightChartInstance = null;
let repsChartInstance = null;
let cloudStatusEl = null;
let hasRenderedApp = false;
let userBarEls = null;
let currentSession = null;

let programState = cloneDefaultProgram();
let programUpdatedAtMs = 0;
let programDirty = false;
let programSaveTimer = null;
let programLoaded = false;

let dashboardUi = null;
const dashboardState = { weekKey: "odd", day: "lundi" };

function init() {
  const selector = document.getElementById("weekSelector");
  // 8 mois = ~32 semaines
  for (let i = 1; i <= 32; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.text = "Semaine " + i;
    selector.add(opt);
  }
  const savedWeek = localStorage.getItem("lastWeek");
  if (savedWeek) {
    currentWeek = Number.parseInt(savedWeek, 10);
    selector.value = String(currentWeek);
  }

  const validDays = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  const validSections = new Set([...validDays, "history", "dashboard"]);
  const savedSection = localStorage.getItem("lastSection");
  if (savedSection && validSections.has(savedSection)) currentSection = savedSection;

  const savedDashWeekKey = localStorage.getItem("dashWeekKey");
  if (savedDashWeekKey === "odd" || savedDashWeekKey === "even") dashboardState.weekKey = savedDashWeekKey;
  const savedDashDay = localStorage.getItem("dashDay");
  if (savedDashDay && validDays.includes(savedDashDay)) dashboardState.day = savedDashDay;

  initGateUi();
  initCloudUi();
}

function changeWeek() {
  currentWeek = Number.parseInt(document.getElementById("weekSelector").value, 10);
  localStorage.setItem("lastWeek", String(currentWeek));
  if (currentSection === "history") updateHistoryCharts();
  else if (currentSection === "dashboard") renderDashboard();
  else renderDay();
}

function setActiveNav(sectionId) {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const id = btn.dataset.section;
    if (id && id === sectionId) btn.classList.add("active");
    else btn.classList.remove("active");
  });
}

function showSection(_evt, sectionId) {
  currentSection = sectionId;
  localStorage.setItem("lastSection", sectionId);
  setActiveNav(sectionId);
  document.querySelectorAll(".section-container").forEach((el) => el.classList.remove("active"));

  if (sectionId === "history") {
    document.getElementById("history-section").classList.add("active");
    updateHistExoSelect();
  } else if (sectionId === "dashboard") {
    document.getElementById("dashboard-section").classList.add("active");
    renderDashboard();
  } else {
    document.getElementById("workout-section").classList.add("active");
    renderDay();
  }
}

function renderSection() {
  showSection(null, currentSection);
}

// --- RENDER WORKOUT ---
function renderDay() {
  loadProgramFromCacheOrDefault();
  const container = document.getElementById("workout-section");
  container.innerHTML = "";

  // Déterminer si Semaine 1 (Impaire) ou Semaine 2 (Paire)
  const isWeek1 = currentWeek % 2 !== 0;
  const weekKey = isWeek1 ? "odd" : "even";
  const activeProgram = programState?.weeks?.[weekKey] || DEFAULT_PROGRAM.weeks[weekKey];
  const cycleText = isWeek1 ? "Cycle : SEMAINE 1 (Impaire)" : "Cycle : SEMAINE 2 (Paire)";

  document.getElementById("cycle-info").innerText = cycleText;

  // Si jour de repos (ex: samedi) ou pas défini
  if (!activeProgram[currentSection]) {
    container.innerHTML =
      '<div style="text-align:center; margin-top:50px; color:#666;">Jour de Repos 💤</div>';
    return;
  }

  activeProgram[currentSection].forEach((exo) => {
    if (!exo?.id) return;
    const card = document.createElement("div");
    card.className = "card";

    // --- CAS SPÉCIAL : ABDOS (STATIC) ---
    if (exo.type === "static") {
      const abdoData = getData(currentWeek, currentSection, exo.id) || { done: false };
      card.innerHTML = `
        <div class="card-header">
          <div>
            <div class="exo-title">${exo.name}</div>
            <div class="exo-subtitle">À faire impérativement</div>
          </div>
        </div>
        <div class="abdo-card-body">
          <button class="abdo-check ${abdoData.done ? "checked" : ""}" onclick="toggleAbdo('${exo.id}', this)">
            <span>${abdoData.done ? "✓" : "○"}</span>
            ${abdoData.done ? "ROUTINE TERMINÉE" : "VALIDER LA ROUTINE"}
          </button>
        </div>
      `;
      container.appendChild(card);
      return; // On arrête là pour cet exo, pas de séries
    }

    // --- CAS STANDARD (MUSCU) ---
    const setCount = Math.max(1, Number.parseInt(exo.sets, 10) || 1);
    const rangeText = exo.range || "";
    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="exo-title">${exo.name}</div>
          <div class="exo-subtitle">${setCount} Séries | ${rangeText} Reps</div>
        </div>
      </div>
    `;

    const setsContainer = document.createElement("div");
    setsContainer.className = "sets-container";
    const exoData = getData(currentWeek, currentSection, exo.id) || { sets: [] };

    for (let i = 0; i < setCount; i++) {
      const setData = exoData.sets[i] || { kg: "", reps: "", done: false };
      const summaryText =
        setData.kg || setData.reps ? `${setData.kg || 0}kg x ${setData.reps || 0}` : "À faire";

      const setDiv = document.createElement("div");
      setDiv.className = `set-accordion ${setData.done ? "completed" : ""}`;
      setDiv.innerHTML = `
        <div class="set-header" onclick="toggleSet(this)">
          <div><span class="set-indicator"></span>SÉRIE ${i + 1}</div>
          <div style="display:flex;align-items:center;"><span class="set-summary">${summaryText}</span>▼</div>
        </div>
        <div class="set-body">
          <div class="inputs-row">
            <div class="input-wrapper"><label>KG</label><input type="number" placeholder="0" value="${setData.kg}" oninput="handleInput('${exo.id}', ${i}, 'kg', this.value)"></div>
            <div class="input-wrapper"><label>REPS</label><input type="number" placeholder="0" value="${setData.reps}" oninput="handleInput('${exo.id}', ${i}, 'reps', this.value)"></div>
          </div>
          <div class="progression-msg" id="prog-${exo.id}-${i}">${calculateProgressionHTML(exo.id, i, setData.kg, setData.reps)}</div>
          <button class="validate-btn" onclick="toggleSetValidation('${exo.id}', ${i}, this)">${setData.done ? "VALIDÉE ✓" : "VALIDER"}</button>
        </div>
      `;
      setsContainer.appendChild(setDiv);
    }
    card.appendChild(setsContainer);
    container.appendChild(card);
  });
}

function toggleSet(header) {
  const accordion = header.parentElement;
  const siblings = accordion.parentElement.querySelectorAll(".set-accordion");
  siblings.forEach((sib) => {
    if (sib !== accordion) sib.classList.remove("active");
  });
  accordion.classList.toggle("active");
}

// --- GESTION ABDOS ---
function toggleAbdo(exoId, btn) {
  const data = getData(currentWeek, currentSection, exoId) || { done: false };
  data.done = !data.done;
  saveData(currentWeek, currentSection, exoId, data);

  if (data.done) {
    btn.classList.add("checked");
    btn.innerHTML = "<span>✓</span> ROUTINE TERMINÉE";
  } else {
    btn.classList.remove("checked");
    btn.innerHTML = "<span>○</span> VALIDER LA ROUTINE";
  }
}

function handleInput(exoId, setIndex, type, value) {
  const data = getData(currentWeek, currentSection, exoId) || { sets: [] };
  if (!data.sets[setIndex]) data.sets[setIndex] = { kg: "", reps: "", done: false };
  data.sets[setIndex][type] = value;
  saveData(currentWeek, currentSection, exoId, data);

  const accordion = document
    .querySelectorAll(".card")
    .item(getExoIndex(exoId))
    .querySelectorAll(".set-accordion")
    .item(setIndex);
  accordion.querySelector(".set-summary").innerText = `${data.sets[setIndex].kg || 0}kg x ${
    data.sets[setIndex].reps || 0
  }`;
  document.getElementById(`prog-${exoId}-${setIndex}`).innerHTML = calculateProgressionHTML(
    exoId,
    setIndex,
    data.sets[setIndex].kg,
    data.sets[setIndex].reps
  );
}

function toggleSetValidation(exoId, setIndex, btn) {
  const data = getData(currentWeek, currentSection, exoId) || { sets: [] };
  if (!data.sets[setIndex]) data.sets[setIndex] = { kg: "", reps: "", done: false };
  data.sets[setIndex].done = !data.sets[setIndex].done;
  saveData(currentWeek, currentSection, exoId, data);

  const accordion = btn.closest(".set-accordion");
  if (data.sets[setIndex].done) {
    accordion.classList.add("completed");
    btn.innerText = "VALIDÉE ✓";
    accordion.classList.remove("active");
  } else {
    accordion.classList.remove("completed");
    btn.innerText = "VALIDER";
  }
}

// --- PROGRESSION ---
function calculateProgressionHTML(exoId, setIndex, currentKg, currentReps) {
  if (currentWeek <= 1) return '<span style="color:#aaa">🏁 Départ</span>';
  const prevData = getData(currentWeek - 1, currentSection, exoId);
  const prevSet = prevData && prevData.sets && prevData.sets[setIndex] ? prevData.sets[setIndex] : null;

  if (!prevSet || (!prevSet.kg && !prevSet.reps)) {
    return '<span class="prog-neutral">Nouvel exo / Pas de data S-' + (currentWeek - 1) + "</span>";
  }

  if ((currentKg === "" || currentKg === null) && (currentReps === "" || currentReps === null)) {
    return `<span class="prog-target">🎯 Objectif : ${prevSet.kg || 0}kg x ${prevSet.reps || 0}</span>`;
  }

  const valKg = currentKg === "" ? 0 : Number.parseFloat(currentKg);
  const valReps = currentReps === "" ? 0 : Number.parseFloat(currentReps);
  const prevKg = Number.parseFloat(prevSet.kg || 0);
  const prevReps = Number.parseFloat(prevSet.reps || 0);

  if (valKg === prevKg && valReps === prevReps && valKg > 0) return '<span class="prog-equal">=</span>';

  let html = "";
  const diffKg = valKg - prevKg;
  if (diffKg > 0) html += `<span class="prog-gain">🔥 +${diffKg}kg</span>`;
  else if (diffKg < 0) html += `<span class="prog-loss">🔻 ${diffKg}kg</span>`;
  else html += '<span class="prog-mini-equal">= kg</span>';

  html += " &nbsp; ";

  const diffReps = valReps - prevReps;
  if (diffReps > 0) html += `<span class="prog-gain"> +${diffReps} Reps</span>`;
  else if (diffReps < 0) html += `<span class="prog-loss"> ${diffReps} Reps</span>`;
  else html += '<span class="prog-mini-equal">= Reps</span>';

  return html;
}

function getExoIndex(exoId) {
  loadProgramFromCacheOrDefault();
  const isWeek1 = currentWeek % 2 !== 0;
  const weekKey = isWeek1 ? "odd" : "even";
  const activeProgram = programState?.weeks?.[weekKey] || DEFAULT_PROGRAM.weeks[weekKey];
  return (activeProgram[currentSection] || []).findIndex((e) => e.id === exoId);
}

function getKey(week, day, exoId) {
  return `trackV9_${week}_${day}_${exoId}`; // V9 pour ne pas mélanger
}
function saveData(week, day, exoId, data) {
  data._ts = Date.now();
  localStorage.setItem(getKey(week, day, exoId), JSON.stringify(data));
  enqueueUpsert(week, day, exoId, data);
}
function getData(week, day, exoId) {
  const d = localStorage.getItem(getKey(week, day, exoId));
  return d ? JSON.parse(d) : null;
}

// --- HISTORY ---
function updateHistExoSelect() {
  loadProgramFromCacheOrDefault();
  const day = document.getElementById("hist-day-select").value;
  const exoSelect = document.getElementById("hist-exo-select");
  exoSelect.innerHTML = "";

  const odd = programState?.weeks?.odd || DEFAULT_PROGRAM.weeks.odd;
  const even = programState?.weeks?.even || DEFAULT_PROGRAM.weeks.even;
  const merged = [...(odd[day] || []), ...(even[day] || [])];
  const uniq = new Map();
  merged.forEach((exo) => {
    if (!exo || exo.type === "static") return;
    if (!uniq.has(exo.id)) uniq.set(exo.id, exo);
  });
  const exosToList = [...uniq.values()];

  if (exosToList.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.text = "Aucun exercice";
    opt.disabled = true;
    opt.selected = true;
    exoSelect.add(opt);
    updateHistSetSelect();
    return;
  }

  exosToList.forEach((exo) => {
    const opt = document.createElement("option");
    opt.value = exo.id;
    opt.text = exo.name;
    exoSelect.add(opt);
  });
  updateHistSetSelect();
}

function updateHistSetSelect() {
  updateHistoryCharts();
}

function updateHistoryCharts() {
  const day = document.getElementById("hist-day-select").value;
  const exoId = document.getElementById("hist-exo-select").value;
  const setIndex = Number.parseInt(document.getElementById("hist-set-select").value, 10);
  if (!exoId) {
    if (weightChartInstance) weightChartInstance.destroy();
    if (repsChartInstance) repsChartInstance.destroy();
    weightChartInstance = null;
    repsChartInstance = null;
    return;
  }
  const labels = [];
  const dataKg = [];
  const dataReps = [];

  for (let w = 1; w <= 32; w++) {
    labels.push(`S${w}`);
    const data = getData(w, day, exoId);
    if (data && data.sets && data.sets[setIndex]) {
      dataKg.push(data.sets[setIndex].kg || null);
      dataReps.push(data.sets[setIndex].reps || null);
    } else {
      dataKg.push(null);
      dataReps.push(null);
    }
  }
  renderChart(
    "weightChart",
    "line",
    labels,
    "Poids (kg)",
    dataKg,
    "#ff3b30",
    weightChartInstance,
    (c) => (weightChartInstance = c)
  );
  renderChart(
    "repsChart",
    "bar",
    labels,
    "Répétitions",
    dataReps,
    "#ffcc00",
    repsChartInstance,
    (c) => (repsChartInstance = c)
  );
}

function renderChart(id, type, labels, label, data, color, inst, setInst) {
  const ctx = document.getElementById(id).getContext("2d");
  if (inst) inst.destroy();
  const cfg = {
    type,
    data: {
      labels,
      datasets: [
        {
          label,
          data,
          borderColor: color,
          backgroundColor: type === "line" ? color + "33" : color,
          fill: type === "line",
          tension: 0.3,
          pointRadius: 2,
          spanGaps: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, grid: { color: "#333" } }, x: { grid: { color: "#333" } } }
    }
  };
  setInst(new Chart(ctx, cfg));
}

function setCloudStatus(text) {
  if (cloudStatusEl) cloudStatusEl.innerText = text;
}

function showShell(name) {
  const authShell = document.getElementById("auth-shell");
  const appShell = document.getElementById("app-shell");
  if (!authShell || !appShell) return;
  if (name === "app") {
    authShell.style.display = "none";
    appShell.style.display = "block";
  } else {
    authShell.style.display = "block";
    appShell.style.display = "none";
  }
}

function ensureAppRendered() {
  if (hasRenderedApp) return;
  hasRenderedApp = true;
  loadProgramFromCacheOrDefault();
  initUserBar();
  updateUserBar(currentSession);
  initDashboardUi();
  updateHistExoSelect();
  renderSection();
}

function initUserBar() {
  if (userBarEls) return;
  const bar = document.getElementById("user-bar");
  const emailEl = document.getElementById("user-email");
  const codeEl = document.getElementById("user-code");
  const loginBtn = document.getElementById("user-login");
  const logoutBtn = document.getElementById("user-logout");
  if (!bar || !emailEl || !codeEl || !loginBtn || !logoutBtn) return;
  userBarEls = { bar, emailEl, codeEl, loginBtn, logoutBtn };

  loginBtn.addEventListener("click", () => {
    localStorage.removeItem("skipAuth");
    showShell("auth");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  logoutBtn.addEventListener("click", async () => {
    await signOut();
  });
}

function updateUserBar(session) {
  if (!userBarEls) return;
  const code = localStorage.getItem("accountCode");
  const show = isSupabaseConfigured || Boolean(code);
  if (!show) {
    userBarEls.bar.style.display = "none";
    return;
  }

  userBarEls.bar.style.display = "flex";
  userBarEls.codeEl.innerText = code ? `Code : ${code}` : "";

  if (session) {
    userBarEls.emailEl.innerText = `Connecté : ${session.user.email}`;
    userBarEls.loginBtn.style.display = "none";
    userBarEls.logoutBtn.style.display = "inline-flex";
    return;
  }

  userBarEls.emailEl.innerText = isSupabaseConfigured ? "Déconnecté" : "Mode local";
  userBarEls.loginBtn.style.display = isSupabaseConfigured ? "inline-flex" : "none";
  userBarEls.logoutBtn.style.display = "none";
}

function loadProgramFromCacheOrDefault() {
  if (programLoaded) return;
  programLoaded = true;
  const cached = loadCachedProgram();
  if (cached?.program) {
    const shaped = ensureProgramShape(cached.program);
    programState = shaped;
    programUpdatedAtMs = shaped === cached.program ? cached.updatedAtMs : Date.now();
    cacheProgram(programState, programUpdatedAtMs);
    return;
  }
  programState = cloneDefaultProgram();
  programUpdatedAtMs = Date.now();
  cacheProgram(programState, programUpdatedAtMs);
}

async function refreshProgramFromCloud(session) {
  if (!session || !isSupabaseConfigured) return;
  loadProgramFromCacheOrDefault();

  const res = await fetchProgramFromCloud(session.user.id);
  if (res.ok) {
    const remoteProgram = ensureProgramShape(res.program);
    const remoteTs =
      typeof res.updatedAtMs === "number" ? res.updatedAtMs : Number.parseInt(String(res.updatedAtMs || 0), 10) || 0;
    if (remoteTs > programUpdatedAtMs) {
      programState = remoteProgram;
      programUpdatedAtMs = remoteTs;
      programDirty = false;
      cacheProgram(programState, programUpdatedAtMs);
      if (dashboardUi) renderDashboard();
      updateHistExoSelect();
      renderSection();
      return;
    }
    if (remoteTs > 0 && remoteTs < programUpdatedAtMs) {
      await upsertProgramToCloud(session.user.id, programState, programUpdatedAtMs);
    }
    return;
  }

  if (res.reason === "not_found") {
    await upsertProgramToCloud(session.user.id, programState, programUpdatedAtMs);
  }
}

function updateProgramStatus(text) {
  if (!dashboardUi?.statusEl) return;
  if (text) {
    dashboardUi.statusEl.innerText = text;
    return;
  }
  if (!currentSession) {
    dashboardUi.statusEl.innerText = isSupabaseConfigured ? "Déconnecté" : "Mode local";
    return;
  }
  dashboardUi.statusEl.innerText = programDirty ? "Modifs en cours..." : "Enregistré";
}

function scheduleProgramSave() {
  window.clearTimeout(programSaveTimer);
  programSaveTimer = window.setTimeout(() => {
    void saveProgramNow();
  }, 800);
}

function touchProgram() {
  loadProgramFromCacheOrDefault();
  programUpdatedAtMs = Date.now();
  cacheProgram(programState, programUpdatedAtMs);
}

function markProgramDirty() {
  touchProgram();
  programDirty = true;
  updateProgramStatus();
  scheduleProgramSave();
}

async function saveProgramNow() {
  loadProgramFromCacheOrDefault();
  if (!programUpdatedAtMs) touchProgram();
  else cacheProgram(programState, programUpdatedAtMs);
  const savingAtMs = programUpdatedAtMs;

  if (!currentSession) {
    if (programUpdatedAtMs === savingAtMs) programDirty = false;
    updateProgramStatus(programDirty ? "Modifs en cours..." : "Sauvé en local");
    return { ok: true, local: true };
  }

  updateProgramStatus("Sauvegarde...");
  const res = await upsertProgramToCloud(currentSession.user.id, programState, savingAtMs);
  if (!res.ok) {
    programDirty = true;
    updateProgramStatus(`Erreur sauvegarde (${res.details || res.reason})`);
    return { ok: false, reason: res.reason, details: res.details };
  }
  if (programUpdatedAtMs !== savingAtMs) {
    programDirty = true;
    updateProgramStatus();
    return { ok: true, stale: true };
  }
  programDirty = false;
  updateProgramStatus("Enregistré");
  return { ok: true };
}

function generateExerciseId() {
  if (globalThis.crypto?.randomUUID) return `exo_${globalThis.crypto.randomUUID().slice(0, 8)}`;
  return `exo_${Math.random().toString(36).slice(2, 10)}`;
}

function ensureProgramDayArray(weekKey, day) {
  loadProgramFromCacheOrDefault();
  if (!programState.weeks) programState.weeks = { odd: {}, even: {} };
  if (!programState.weeks[weekKey]) programState.weeks[weekKey] = {};
  if (!Array.isArray(programState.weeks[weekKey][day])) programState.weeks[weekKey][day] = [];
  return programState.weeks[weekKey][day];
}

function initDashboardUi() {
  if (dashboardUi) return;
  const root = document.getElementById("dashboard-root");
  if (!root) return;

  root.innerHTML = `
    <div class="dashboard-layout">
      <div class="card">
        <div class="card-header">
          <div>
            <div class="exo-title">Dashboard</div>
            <div class="exo-subtitle">Planifie sur PC, track sur mobile</div>
          </div>
          <div id="program-status" class="exo-subtitle"></div>
        </div>
        <div class="sync-card-body">
          <div class="dashboard-controls">
            <select id="dash-cycle" class="hist-select">
              <option value="odd">Semaine impaire (S1)</option>
              <option value="even">Semaine paire (S2)</option>
            </select>
            <select id="dash-day" class="hist-select">
              <option value="lundi">Lundi</option>
              <option value="mardi">Mardi</option>
              <option value="mercredi">Mercredi</option>
              <option value="jeudi">Jeudi</option>
              <option value="vendredi">Vendredi</option>
              <option value="samedi">Samedi</option>
              <option value="dimanche">Dimanche</option>
            </select>
            <button id="dash-add" class="sync-btn primary" type="button">+ Exercice</button>
            <button id="dash-save" class="sync-btn" type="button">Sauver</button>
            <button id="dash-reset" class="sync-btn danger" type="button">Reset</button>
          </div>
          <div id="dash-list" class="dash-list"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="exo-title">Outils</div>
            <div class="exo-subtitle">Sauvegarde, sync & partage</div>
          </div>
        </div>
        <div class="sync-card-body">
          <div class="sync-status">
            Les changements du programme sont sauvegardés automatiquement quand tu es connecté.
          </div>
          <div class="sync-status">Programme</div>
          <div class="sync-row">
            <button id="dash-export" class="sync-btn" type="button">Exporter JSON</button>
            <button id="dash-import" class="sync-btn" type="button">Importer JSON</button>
          </div>
          <div class="sync-row">
            <button id="dash-prog-pull" class="sync-btn" type="button">Programme ↓</button>
            <button id="dash-prog-push" class="sync-btn" type="button">Programme ↑</button>
          </div>
          <div class="sync-status">Historique (séries / poids / reps)</div>
          <div class="sync-row">
            <button id="dash-sync-pull" class="sync-btn" type="button">Historique ↓</button>
            <button id="dash-sync-push" class="sync-btn" type="button">Historique ↑</button>
          </div>
          <div id="dash-msg" class="sync-status"></div>
          <div class="sync-status">
            Astuce : tu peux planifier sur PC, puis tracker sur mobile avec le même compte (code).
          </div>
        </div>
      </div>
    </div>
  `;

  const cycleSelect = document.getElementById("dash-cycle");
  const daySelect = document.getElementById("dash-day");
  const listEl = document.getElementById("dash-list");
  const statusEl = document.getElementById("program-status");
  const addBtn = document.getElementById("dash-add");
  const saveBtn = document.getElementById("dash-save");
  const resetBtn = document.getElementById("dash-reset");
  const exportBtn = document.getElementById("dash-export");
  const importBtn = document.getElementById("dash-import");
  const progPullBtn = document.getElementById("dash-prog-pull");
  const progPushBtn = document.getElementById("dash-prog-push");
  const syncPullBtn = document.getElementById("dash-sync-pull");
  const syncPushBtn = document.getElementById("dash-sync-push");
  const msgEl = document.getElementById("dash-msg");

  dashboardUi = {
    root,
    cycleSelect,
    daySelect,
    listEl,
    statusEl,
    addBtn,
    saveBtn,
    resetBtn,
    exportBtn,
    importBtn,
    progPullBtn,
    progPushBtn,
    syncPullBtn,
    syncPushBtn,
    msgEl
  };

  cycleSelect.value = dashboardState.weekKey;
  daySelect.value = dashboardState.day;

  cycleSelect.addEventListener("change", () => {
    dashboardState.weekKey = cycleSelect.value;
    localStorage.setItem("dashWeekKey", dashboardState.weekKey);
    renderDashboard();
  });
  daySelect.addEventListener("change", () => {
    dashboardState.day = daySelect.value;
    localStorage.setItem("dashDay", dashboardState.day);
    renderDashboard();
  });

  addBtn.addEventListener("click", () => {
    const dayArr = ensureProgramDayArray(dashboardState.weekKey, dashboardState.day);
    dayArr.push({ id: generateExerciseId(), name: "Nouvel exercice", sets: 3, range: "8-12" });
    markProgramDirty();
    renderDashboard();
  });

  saveBtn.addEventListener("click", async () => {
    await saveProgramNow();
  });

  resetBtn.addEventListener("click", async () => {
    const ok = window.confirm("Remettre le programme par défaut ? (cela écrasera tes modifications)");
    if (!ok) return;
    programState = cloneDefaultProgram();
    programUpdatedAtMs = Date.now();
    cacheProgram(programState, programUpdatedAtMs);
    programDirty = true;
    renderDashboard();
    await saveProgramNow();
    renderSection();
    updateHistExoSelect();
  });

  exportBtn.addEventListener("click", async () => {
    loadProgramFromCacheOrDefault();
    const txt = JSON.stringify(programState, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      updateProgramStatus("JSON copié");
    } catch {
      window.prompt("Copie ce JSON:", txt);
    }
  });

  importBtn.addEventListener("click", async () => {
    const txt = window.prompt("Colle ici le JSON du programme :");
    if (!txt) return;
    try {
      const parsed = JSON.parse(txt);
      const shaped = ensureProgramShape(parsed);
      programState = shaped;
      programUpdatedAtMs = Date.now();
      cacheProgram(programState, programUpdatedAtMs);
      markProgramDirty();
      renderDashboard();
      await saveProgramNow();
      renderSection();
      updateHistExoSelect();
    } catch {
      window.alert("JSON invalide");
    }
  });

  function setMsg(text) {
    msgEl.innerText = text || "";
  }

  progPullBtn.addEventListener("click", async () => {
    if (!currentSession) {
      setMsg("Connecte-toi pour synchroniser.");
      return;
    }
    if (programDirty) {
      const ok = window.confirm("Tu as des modifications non sauvegardées. Écraser avec le cloud ?");
      if (!ok) return;
    }
    setMsg("Récupération du programme...");
    const res = await fetchProgramFromCloud(currentSession.user.id);
    if (!res.ok) {
      setMsg("Erreur programme: " + (res.details || res.reason));
      return;
    }
    programState = ensureProgramShape(res.program);
    const remoteTs =
      typeof res.updatedAtMs === "number" ? res.updatedAtMs : Number.parseInt(String(res.updatedAtMs || 0), 10) || 0;
    programUpdatedAtMs = remoteTs || Date.now();
    programDirty = false;
    cacheProgram(programState, programUpdatedAtMs);
    updateProgramStatus("Programme récupéré");
    renderDashboard();
    updateHistExoSelect();
    renderSection();
    setMsg("Programme récupéré.");
  });

  progPushBtn.addEventListener("click", async () => {
    if (!currentSession) {
      setMsg("Connecte-toi pour synchroniser.");
      return;
    }
    setMsg("Envoi du programme...");
    const res = await saveProgramNow();
    if (!res?.ok) setMsg("Erreur programme: " + (res?.details || res?.reason || "sauvegarde"));
    else setMsg(res.stale ? "Programme envoyé (modifs plus récentes en cours)." : "Programme envoyé.");
  });

  syncPullBtn.addEventListener("click", async () => {
    if (!currentSession) {
      setMsg("Connecte-toi pour synchroniser.");
      return;
    }
    setMsg("Sync historique depuis le cloud...");
    const res = await syncCloudToLocal();
    if (!res.ok) setMsg("Erreur sync: " + res.reason);
    else {
      setMsg(`OK: ${res.updated} entrées mises à jour`);
      renderSection();
    }
  });

  syncPushBtn.addEventListener("click", async () => {
    if (!currentSession) {
      setMsg("Connecte-toi pour synchroniser.");
      return;
    }
    setMsg("Sync historique vers le cloud...");
    const res = await syncLocalToCloud();
    if (!res.ok) setMsg("Erreur sync: " + res.reason);
    else setMsg(`OK: ${res.pushed} entrées envoyées`);
  });
}

function renderDashboard() {
  loadProgramFromCacheOrDefault();
  initDashboardUi();
  if (!dashboardUi?.listEl) return;

  updateProgramStatus();

  dashboardUi.cycleSelect.value = dashboardState.weekKey;
  dashboardUi.daySelect.value = dashboardState.day;

  const listEl = dashboardUi.listEl;
  listEl.innerHTML = "";

  const dayArr = ensureProgramDayArray(dashboardState.weekKey, dashboardState.day);
  if (dayArr.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sync-status";
    empty.innerText = "Aucun exercice pour ce jour. Ajoute-en un.";
    listEl.appendChild(empty);
    return;
  }

  dayArr.forEach((exo, idx) => {
    const isStatic = exo?.type === "static";
    const row = document.createElement("div");
    row.className = "dash-exo";

    const typeField = document.createElement("div");
    typeField.className = "dash-field";
    typeField.innerHTML = `<div class="dash-label">Type</div>`;
    const typeSelect = document.createElement("select");
    typeSelect.className = "hist-select";
    typeSelect.innerHTML = `
      <option value="work">Muscu</option>
      <option value="static">Routine</option>
    `;
    typeSelect.value = isStatic ? "static" : "work";
    typeField.appendChild(typeSelect);

    const nameField = document.createElement("div");
    nameField.className = "dash-field";
    nameField.innerHTML = `<div class="dash-label">Nom</div>`;
    const nameInput = document.createElement("input");
    nameInput.className = "sync-input";
    nameInput.type = "text";
    nameInput.value = exo?.name || "";
    nameField.appendChild(nameInput);

    const main = document.createElement("div");
    main.className = "dash-exo-main";
    main.appendChild(typeField);
    main.appendChild(nameField);

    const setsField = document.createElement("div");
    setsField.className = "dash-field";
    setsField.innerHTML = `<div class="dash-label">Séries</div>`;
    const setsInput = document.createElement("input");
    setsInput.className = "sync-input";
    setsInput.type = "number";
    setsInput.min = "1";
    setsInput.max = "10";
    setsInput.value = String(exo?.sets ?? 3);
    setsField.appendChild(setsInput);

    const rangeField = document.createElement("div");
    rangeField.className = "dash-field";
    rangeField.innerHTML = `<div class="dash-label">Reps</div>`;
    const rangeInput = document.createElement("input");
    rangeInput.className = "sync-input";
    rangeInput.type = "text";
    rangeInput.placeholder = "8-12";
    rangeInput.value = exo?.range || "";
    rangeField.appendChild(rangeInput);

    if (!isStatic) {
      main.appendChild(setsField);
      main.appendChild(rangeField);
    }

    const actions = document.createElement("div");
    actions.className = "dash-exo-actions";

    const upBtn = document.createElement("button");
    upBtn.className = "dash-mini-btn";
    upBtn.type = "button";
    upBtn.innerText = "↑";
    upBtn.title = "Monter";
    upBtn.disabled = idx === 0;

    const downBtn = document.createElement("button");
    downBtn.className = "dash-mini-btn";
    downBtn.type = "button";
    downBtn.innerText = "↓";
    downBtn.title = "Descendre";
    downBtn.disabled = idx === dayArr.length - 1;

    const delBtn = document.createElement("button");
    delBtn.className = "dash-mini-btn danger";
    delBtn.type = "button";
    delBtn.innerText = "✕";
    delBtn.title = "Supprimer";

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(delBtn);

    row.appendChild(main);
    row.appendChild(actions);
    listEl.appendChild(row);

    nameInput.addEventListener("input", () => {
      exo.name = nameInput.value;
      markProgramDirty();
    });

    typeSelect.addEventListener("change", () => {
      if (typeSelect.value === "static") {
        exo.type = "static";
        delete exo.sets;
        delete exo.range;
      } else {
        delete exo.type;
        exo.sets = Number.parseInt(setsInput.value, 10) || 3;
        exo.range = rangeInput.value || "8-12";
      }
      markProgramDirty();
      renderDashboard();
    });

    setsInput.addEventListener("input", () => {
      const v = Number.parseInt(setsInput.value, 10);
      exo.sets = Number.isFinite(v) ? Math.min(10, Math.max(1, v)) : 3;
      markProgramDirty();
    });

    rangeInput.addEventListener("input", () => {
      exo.range = rangeInput.value;
      markProgramDirty();
    });

    upBtn.addEventListener("click", () => {
      dayArr.splice(idx - 1, 0, dayArr.splice(idx, 1)[0]);
      markProgramDirty();
      renderDashboard();
    });

    downBtn.addEventListener("click", () => {
      dayArr.splice(idx + 1, 0, dayArr.splice(idx, 1)[0]);
      markProgramDirty();
      renderDashboard();
    });

    delBtn.addEventListener("click", () => {
      const ok = window.confirm("Supprimer cet exercice ?");
      if (!ok) return;
      dayArr.splice(idx, 1);
      markProgramDirty();
      renderDashboard();
    });
  });
}

function initGateUi() {
  const skipBtn = document.getElementById("skip-auth");
  if (skipBtn) {
    skipBtn.addEventListener("click", () => {
      localStorage.setItem("skipAuth", "1");
      showShell("app");
      ensureAppRendered();
    });
  }

  if (!isSupabaseConfigured) {
    showShell("app");
    ensureAppRendered();
    return;
  }

  const skipAuth = localStorage.getItem("skipAuth") === "1";
  if (skipAuth) {
    showShell("app");
    ensureAppRendered();
  } else {
    showShell("auth");
  }
}

function initCloudUi() {
  const mount = document.getElementById("sync-section");
  if (!mount) return;

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="exo-title">Cloud Sync</div>
        <div class="exo-subtitle">Sauvegarde multi-appareils</div>
      </div>
    </div>
    <div class="sync-card-body">
      <div class="sync-status" id="cloud-status">...</div>
      <div class="sync-row" id="cloud-code-actions" style="display:none;">
        <div class="sync-status" id="cloud-code-display"></div>
        <button id="cloud-copy-code" class="sync-btn" type="button">Copier code</button>
      </div>
      <div class="sync-row" id="cloud-code-row">
        <input id="cloud-code" class="sync-input" placeholder="Code (ex: XXXX-XXXX-XXXX)" autocomplete="one-time-code" />
        <button id="cloud-code-login" class="sync-btn primary" type="button">Connexion</button>
      </div>
      <div class="sync-row" id="cloud-email-row">
        <input id="cloud-email" class="sync-input" type="email" placeholder="Email" autocomplete="email" />
        <button id="cloud-email-send" class="sync-btn" type="button">Envoyer lien</button>
      </div>
      <div class="sync-status" id="cloud-hint">
        Pas de code ? Entre ton email pour recevoir un lien (et retrouver ton code).
      </div>
      <div class="sync-row" id="cloud-actions-row" style="display:none;">
        <button id="cloud-pull" class="sync-btn" type="button">Récupérer</button>
        <button id="cloud-push" class="sync-btn" type="button">Sauver</button>
        <button id="cloud-logout" class="sync-btn danger" type="button">Quitter</button>
      </div>
    </div>
  `;
  mount.appendChild(card);

  cloudStatusEl = document.getElementById("cloud-status");
  const codeRow = document.getElementById("cloud-code-row");
  const emailRow = document.getElementById("cloud-email-row");
  const actionsRow = document.getElementById("cloud-actions-row");
  const codeActionsRow = document.getElementById("cloud-code-actions");
  const codeDisplayEl = document.getElementById("cloud-code-display");
  const copyCodeBtn = document.getElementById("cloud-copy-code");
  const codeInput = document.getElementById("cloud-code");
  const codeLoginBtn = document.getElementById("cloud-code-login");
  const emailInput = document.getElementById("cloud-email");
  const hintEl = document.getElementById("cloud-hint");
  const emailSendBtn = document.getElementById("cloud-email-send");
  const pullBtn = document.getElementById("cloud-pull");
  const pushBtn = document.getElementById("cloud-push");
  const logoutBtn = document.getElementById("cloud-logout");
  emailInput.value = localStorage.getItem("cloudEmail") || "";
  codeInput.value = localStorage.getItem("accountCode") || "";

  function formatAccountCode(code) {
    const normalized = normalizeAccountCode(code);
    if (!normalized) return "";
    return normalized.replace(/(.{4})/g, "$1-").replace(/-$/, "");
  }

  function setStoredAccountCode(code) {
    const formatted = formatAccountCode(code);
    if (!formatted) return;
    localStorage.setItem("accountCode", formatted);
    codeDisplayEl.innerText = `Ton code: ${formatted}`;
    codeActionsRow.style.display = "flex";
    if (userBarEls) userBarEls.codeEl.innerText = `Code : ${formatted}`;
  }

  function consumeAccountParam() {
    const params = new URLSearchParams(window.location.search);
    const account = params.get("account");
    if (!account) return null;
    setStoredAccountCode(account);
    params.delete("account");
    const qs = params.toString();
    const nextUrl = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
    window.history.replaceState({}, "", nextUrl);
    return account;
  }

  function setSignedInUi(session) {
    if (session) {
      codeRow.style.display = "none";
      emailRow.style.display = "none";
      hintEl.style.display = "none";
      actionsRow.style.display = "flex";
      const stored = localStorage.getItem("accountCode");
      if (stored) {
        codeDisplayEl.innerText = `Ton code: ${stored}`;
        codeActionsRow.style.display = "flex";
      } else {
        codeActionsRow.style.display = "none";
      }
      setCloudStatus(`Connecté : ${session.user.email}`);
    } else {
      codeRow.style.display = "flex";
      emailRow.style.display = "flex";
      hintEl.style.display = "block";
      actionsRow.style.display = "none";
      codeActionsRow.style.display = "none";
      setCloudStatus("Déconnecté");
    }
    updateUserBar(session);
  }

  if (!isSupabaseConfigured) {
    setCloudStatus("Cloud désactivé (variables VITE_SUPABASE_* manquantes)");
    codeLoginBtn.disabled = true;
    emailSendBtn.disabled = true;
    pullBtn.disabled = true;
    pushBtn.disabled = true;
    logoutBtn.disabled = true;
    return;
  }

  function getEmail() {
    return (emailInput.value || "").trim().toLowerCase();
  }

  function getCode() {
    return codeInput.value || "";
  }

  async function sendLoginEmail() {
    const email = getEmail();
    if (!email) return;
    localStorage.setItem("cloudEmail", email);
    setCloudStatus("Envoi du lien...");
    const res = await requestLoginEmail(email);
    if (!res.ok) {
      const details = res.details ? ` (${res.details})` : "";
      if (res.reason === "otp_send_failed") setCloudStatus("Erreur: envoi email impossible" + details);
      else setCloudStatus("Erreur: " + res.reason + details);
    }
    else setCloudStatus("Email envoyé. Clique le lien pour te connecter.");
  }

  emailInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await sendLoginEmail();
    }
  });
  emailSendBtn.addEventListener("click", sendLoginEmail);

  copyCodeBtn.addEventListener("click", async () => {
    const stored = localStorage.getItem("accountCode");
    if (!stored) return;
    try {
      await navigator.clipboard.writeText(stored);
      setCloudStatus("Code copié.");
    } catch {
      setCloudStatus("Copie impossible (navigateur).");
    }
  });

  codeInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await codeLoginBtn.click();
    }
  });
  codeLoginBtn.addEventListener("click", async () => {
    const code = getCode();
    if (!code) return;
    setCloudStatus("Connexion...");
    const res = await loginWithAccountCode(code);
    if (!res.ok) {
      const details = res.details ? ` (${res.details})` : "";
      setCloudStatus("Erreur: " + res.reason + details);
    }
    else setStoredAccountCode(code);
  });

  pullBtn.addEventListener("click", async () => {
    setCloudStatus("Récupération du cloud...");
    const res = await syncCloudToLocal();
    if (!res.ok) setCloudStatus("Erreur cloud: " + res.reason);
    else {
      setCloudStatus(`OK: ${res.updated} entrées mises à jour depuis le cloud`);
      if (currentSection !== "history") renderDay();
      else updateHistoryCharts();
    }
  });

  pushBtn.addEventListener("click", async () => {
    setCloudStatus("Sauvegarde vers le cloud...");
    const res = await syncLocalToCloud();
    if (!res.ok) setCloudStatus("Erreur cloud: " + res.reason);
    else setCloudStatus(`OK: ${res.pushed} entrées envoyées`);
  });

  logoutBtn.addEventListener("click", async () => {
    await signOut();
  });

  async function tryLoginFromUrl() {
    const account = consumeAccountParam();
    if (!account) return;

    showShell("auth");
    codeInput.value = account;
    setCloudStatus("Connexion via lien...");
    const res = await loginWithAccountCode(account);
    if (res.ok) {
      showShell("app");
      ensureAppRendered();
    } else {
      setCloudStatus("Lien invalide. Entre ton code ou ton email.");
    }
  }

  getSession().then(async (session) => {
    // Même si Supabase t'a déjà loggé via le magic link, on consomme le param `account` si présent.
    consumeAccountParam();
    setSignedInUi(session);
    if (!session) {
      await tryLoginFromUrl();
      session = await getSession();
      setSignedInUi(session);
    }
    currentSession = session;
    if (session) {
      showShell("app");
      ensureAppRendered();
      updateUserBar(session);
      if (!localStorage.getItem("accountCode")) {
        const my = await fetchMyAccountCode(session.access_token);
        if (my.ok && my.code) setStoredAccountCode(my.code);
      }
      await refreshProgramFromCloud(session);
      setCloudStatus("Sync initiale...");
      await syncCloudToLocal();
      await syncLocalToCloud();
      setCloudStatus(`Connecté : ${session.user.email} (sync OK)`);
    }
  });

  onAuthChange(async (session) => {
    setSignedInUi(session);
    currentSession = session;
    if (session) {
      showShell("app");
      ensureAppRendered();
      updateUserBar(session);
      consumeAccountParam();
      if (!localStorage.getItem("accountCode")) {
        const my = await fetchMyAccountCode(session.access_token);
        if (my.ok && my.code) setStoredAccountCode(my.code);
      }
      await refreshProgramFromCloud(session);
      setCloudStatus("Sync initiale...");
      await syncCloudToLocal();
      await syncLocalToCloud();
      setCloudStatus(`Connecté : ${session.user.email} (sync OK)`);
    } else {
      // Reset UI to clean state
      emailInput.value = localStorage.getItem("cloudEmail") || "";
      codeInput.value = localStorage.getItem("accountCode") || "";
      const skipAuth = localStorage.getItem("skipAuth") === "1";
      if (!skipAuth) showShell("auth");
      updateUserBar(null);
      updateProgramStatus();
    }
  });
}

window.changeWeek = changeWeek;
window.showSection = showSection;
window.toggleSet = toggleSet;
window.toggleAbdo = toggleAbdo;
window.handleInput = handleInput;
window.toggleSetValidation = toggleSetValidation;
window.updateHistExoSelect = updateHistExoSelect;
window.updateHistSetSelect = updateHistSetSelect;
window.updateHistoryCharts = updateHistoryCharts;

window.addEventListener("DOMContentLoaded", init);
