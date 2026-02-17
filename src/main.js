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

// --- DATA DU PROGRAMME ---
// SEMAINE 1 (IMPAIRE)
const prog_S1 = {
  lundi: [
    { id: "poulie_h", name: "Poulie Haute Ext.", sets: 4, range: "10-15" },
    { id: "poulie_b", name: "Poulie Basse Ext.", sets: 4, range: "10-15" },
    { id: "dev_halt", name: "Dev. Haltères (Pecs)", sets: 3, range: "8-15" },
    { id: "dev_smith", name: "Dev. Smith (Pecs)", sets: 3, range: "8-15" },
    { id: "ecarte", name: "Écarté Poulie", sets: 4, range: "12-20" }
  ],
  mardi: [
    { id: "presse", name: "Presse à Cuisses", sets: 4, range: "8-15" },
    { id: "leg_ext", name: "Leg Extension Assis", sets: 4, range: "8-15" },
    { id: "add_ext", name: "Adducteur Externe", sets: 4, range: "12-20" },
    { id: "add_int", name: "Adducteur Interne", sets: 4, range: "12-20" },
    { id: "mollets", name: "Mollets", sets: 4, range: "15-25" }
  ],
  mercredi: [{ id: "abdos_1", name: "Routine Abdos", type: "static" }],
  jeudi: [
    { id: "pullover", name: "Pull-over", sets: 4, range: "10-20" },
    { id: "tir_vert", name: "Tirage Vert. Serré", sets: 4, range: "8-15" },
    { id: "tir_horiz", name: "Tirage Horizontal", sets: 4, range: "8-15" },
    { id: "curl_inc", name: "Curl Incliné", sets: 4, range: "8-15" },
    { id: "curl_mart", name: "Curl Marteau Assis", sets: 4, range: "8-15" }
  ],
  vendredi: [
    { id: "dev_mili", name: "Dev. Militaire Smith", sets: 3, range: "8-15" },
    { id: "elev_lat", name: "Élévations Latérales", sets: 4, range: "15-25" },
    { id: "arriere_ep", name: "Arrière d'Épaules", sets: 4, range: "20-30" },
    { id: "tri_uni", name: "Triceps Unilatéral", sets: 5, range: "10-15" },
    { id: "abdos_2", name: "Routine Abdos", type: "static" }
  ],
  dimanche: [
    { id: "sdt_r", name: "Deadlift Roumain", sets: 4, range: "8-15" },
    { id: "releve_buste", name: "Relevé Buste Lomb.", sets: 4, range: "8-15" },
    { id: "curl_assis", name: "Curl Biceps Assis", sets: 4, range: "8-15" },
    { id: "abdos_3", name: "Routine Abdos", type: "static" }
  ]
};

// SEMAINE 2 (PAIRE) - Seul Mardi Change
const prog_S2 = JSON.parse(JSON.stringify(prog_S1)); // Copie de base
prog_S2.mardi = [
  { id: "presse", name: "Presse à Cuisses", sets: 4, range: "8-15" },
  { id: "leg_curl", name: "Leg Curl Assis", sets: 4, range: "8-15" }, // LE CHANGEMENT
  { id: "add_ext", name: "Adducteur Externe", sets: 4, range: "12-20" },
  { id: "add_int", name: "Adducteur Interne", sets: 4, range: "12-20" },
  { id: "mollets", name: "Mollets", sets: 4, range: "15-25" }
];

let currentWeek = 1;
let currentSection = "lundi";
let weightChartInstance = null;
let repsChartInstance = null;
let cloudStatusEl = null;
let hasRenderedApp = false;
let userBarEls = null;

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
  initGateUi();
  initCloudUi();
}

function changeWeek() {
  currentWeek = Number.parseInt(document.getElementById("weekSelector").value, 10);
  localStorage.setItem("lastWeek", String(currentWeek));
  if (currentSection !== "history") renderDay();
}

function showSection(evt, sectionId) {
  currentSection = sectionId;
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.remove("active"));
  if (evt?.target) evt.target.classList.add("active");
  document.querySelectorAll(".section-container").forEach((el) => el.classList.remove("active"));

  if (sectionId === "history") {
    document.getElementById("history-section").classList.add("active");
    updateHistoryCharts();
  } else {
    document.getElementById("workout-section").classList.add("active");
    renderDay();
  }
}

function renderSection() {
  if (currentSection === "history") updateHistoryCharts();
  else renderDay();
}

// --- RENDER WORKOUT ---
function renderDay() {
  const container = document.getElementById("workout-section");
  container.innerHTML = "";

  // Déterminer si Semaine 1 (Impaire) ou Semaine 2 (Paire)
  const isWeek1 = currentWeek % 2 !== 0;
  const activeProgram = isWeek1 ? prog_S1 : prog_S2;
  const cycleText = isWeek1 ? "Cycle : SEMAINE 1 (Impaire)" : "Cycle : SEMAINE 2 (Paire)";

  document.getElementById("cycle-info").innerText = cycleText;

  // Si jour de repos (ex: samedi) ou pas défini
  if (!activeProgram[currentSection]) {
    container.innerHTML =
      '<div style="text-align:center; margin-top:50px; color:#666;">Jour de Repos 💤</div>';
    return;
  }

  activeProgram[currentSection].forEach((exo) => {
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
    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="exo-title">${exo.name}</div>
          <div class="exo-subtitle">${exo.sets} Séries | ${exo.range} Reps</div>
        </div>
      </div>
    `;

    const setsContainer = document.createElement("div");
    setsContainer.className = "sets-container";
    const exoData = getData(currentWeek, currentSection, exo.id) || { sets: [] };

    for (let i = 0; i < exo.sets; i++) {
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
  // On doit chercher dans le programme ACTIF (S1 ou S2)
  const isWeek1 = currentWeek % 2 !== 0;
  const activeProgram = isWeek1 ? prog_S1 : prog_S2;
  return activeProgram[currentSection].findIndex((e) => e.id === exoId);
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
  const day = document.getElementById("hist-day-select").value;
  const exoSelect = document.getElementById("hist-exo-select");
  exoSelect.innerHTML = "";

  // Pour l'historique, on utilise la S1 comme référence de liste (ou merge S1/S2 pour mardi)
  // Astuce : On liste tout ce qui est possible
  let exosToList = [];
  if (day === "mardi") {
    // Fusion des exos de S1 et S2 pour mardi
    exosToList = [...prog_S1.mardi];
    // Ajouter Leg Curl s'il n'y est pas (c'est le seul qui change)
    if (!exosToList.find((e) => e.id === "leg_curl")) exosToList.push({ id: "leg_curl", name: "Leg Curl Assis" });
  } else {
    exosToList = prog_S1[day] || [];
  }

  exosToList.forEach((exo) => {
    // On ne montre PAS les abdos dans l'historique
    if (exo.type !== "static") {
      const opt = document.createElement("option");
      opt.value = exo.id;
      opt.text = exo.name;
      exoSelect.add(opt);
    }
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
  initUserBar();
  renderSection();
  updateHistExoSelect();
}

function initUserBar() {
  if (userBarEls) return;
  const bar = document.getElementById("user-bar");
  const emailEl = document.getElementById("user-email");
  const codeEl = document.getElementById("user-code");
  const logoutBtn = document.getElementById("user-logout");
  if (!bar || !emailEl || !codeEl || !logoutBtn) return;
  userBarEls = { bar, emailEl, codeEl, logoutBtn };

  logoutBtn.addEventListener("click", async () => {
    await signOut();
  });
}

function updateUserBar(session) {
  if (!userBarEls) return;
  if (!session) {
    userBarEls.bar.style.display = "none";
    return;
  }
  userBarEls.bar.style.display = "flex";
  userBarEls.emailEl.innerText = `Connecté : ${session.user.email}`;
  const code = localStorage.getItem("accountCode");
  userBarEls.codeEl.innerText = code ? `Code : ${code}` : "";
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
    if (session) {
      showShell("app");
      ensureAppRendered();
      updateUserBar(session);
      if (!localStorage.getItem("accountCode")) {
        const my = await fetchMyAccountCode(session.access_token);
        if (my.ok && my.code) setStoredAccountCode(my.code);
      }
      setCloudStatus("Sync initiale...");
      await syncCloudToLocal();
      await syncLocalToCloud();
      setCloudStatus(`Connecté : ${session.user.email} (sync OK)`);
    }
  });

  onAuthChange(async (session) => {
    setSignedInUi(session);
    if (session) {
      showShell("app");
      ensureAppRendered();
      updateUserBar(session);
      consumeAccountParam();
      if (!localStorage.getItem("accountCode")) {
        const my = await fetchMyAccountCode(session.access_token);
        if (my.ok && my.code) setStoredAccountCode(my.code);
      }
      setCloudStatus("Sync initiale...");
      await syncCloudToLocal();
      await syncLocalToCloud();
      setCloudStatus(`Connecté : ${session.user.email} (sync OK)`);
    } else {
      // Reset UI to clean state
      emailInput.value = localStorage.getItem("cloudEmail") || "";
      codeInput.value = "";
      const skipAuth = localStorage.getItem("skipAuth") === "1";
      if (!skipAuth) showShell("auth");
      updateUserBar(null);
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
