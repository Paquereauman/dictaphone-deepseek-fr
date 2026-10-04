/**
 * Popup « options rapides » : statut du serveur, dictee dans l'onglet courant,
 * corrections personnelles et vocabulaire — modifiables a la volee.
 *
 * Rien de ce qui est saisi ici ne demande de redemarrer le serveur : les
 * reglages sont envoyes au debut de chaque session de dictee.
 */

const DEFAULTS = {
  serverUrl: "http://127.0.0.1:8765",
  language: "fr",
  model: "",
  autoInsert: true,
  showPartial: true,
  beep: true,
  stopOnHide: true,
  maxMinutes: 5,
  vocabulary: "",
  replacements: {},
};

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const dot = $("dot");

let settings = { ...DEFAULTS };
let recording = false;

function setStatus(text, kind) {
  statusEl.textContent = text;
  dot.className = "dot" + (kind ? " " + kind : "");
}

function flash(msg) {
  const el = $("saved");
  el.textContent = msg;
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { el.textContent = ""; }, 1800);
}

async function load() {
  settings = await chrome.storage.sync.get(DEFAULTS);
  $("autoInsert").checked = Boolean(settings.autoInsert);
  $("showPartial").checked = Boolean(settings.showPartial);
  $("beep").checked = Boolean(settings.beep);
  $("stopOnHide").checked = Boolean(settings.stopOnHide);
  $("vocabulary").value = settings.vocabulary || "";
  renderFixes();
  refreshServer();
  refreshTabState();
}

/**
 * Interroge l'onglet pour savoir s'il enregistre deja. Sans cela, le bouton
 * affichait « Dicter » alors que le micro etait ouvert — impossible de savoir
 * qu'il fallait cliquer pour arreter.
 */
async function refreshTabState() {
  let recording = false;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const r = await chrome.tabs.sendMessage(tab.id, { type: "state" });
      recording = Boolean(r?.recording);
    }
  } catch {
    recording = false;
  }
  const btn = $("toggle");
  btn.textContent = recording ? "ARRÊTER LA DICTÉE" : "Dicter dans cet onglet";
  btn.classList.toggle("rec", recording);
  $("toggleHint").textContent = recording
    ? "Le micro est ouvert en ce moment."
    : "";
  return recording;
}

async function refreshServer() {
  const base = String(settings.serverUrl || DEFAULTS.serverUrl).replace(/\/+$/, "");
  try {
    const r = await fetch(`${base}/health`, { cache: "no-store" });
    const j = await r.json();
    setStatus(
      j.model_loaded
        ? `Serveur prêt — ${j.model} / ${j.device}`
        : `Serveur prêt — ${j.model} (se chargera à la 1re dictée)`,
      "ok",
    );
  } catch {
    setStatus("Serveur arrêté — lance demarrage-auto.bat ou start.bat", "bad");
  }
}

// --------------------------------------------------------------------------- //
//  Corrections personnelles
// --------------------------------------------------------------------------- //
function renderFixes() {
  const table = settings.replacements || {};
  const keys = Object.keys(table);
  const box = $("chips");
  box.innerHTML = "";
  $("emptyFixes").hidden = keys.length > 0;

  for (const key of keys) {
    const chip = document.createElement("div");
    chip.className = "chip";
    const label = document.createElement("span");
    label.innerHTML = `${escapeHtml(key)} <b>→ ${escapeHtml(table[key])}</b>`;
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "×";
    del.title = "Supprimer";
    del.addEventListener("click", async () => {
      const next = { ...(settings.replacements || {}) };
      delete next[key];
      settings.replacements = next;
      await chrome.storage.sync.set({ replacements: next });
      renderFixes();
      flash("supprimé");
    });
    chip.append(label, del);
    box.appendChild(chip);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function addFix() {
  const heard = $("heard").value.trim();
  const fixed = $("fixed").value.trim();
  if (!heard) { $("heard").focus(); return; }
  const next = { ...(settings.replacements || {}), [heard.toLowerCase()]: fixed };
  settings.replacements = next;
  await chrome.storage.sync.set({ replacements: next });
  $("heard").value = "";
  $("fixed").value = "";
  $("heard").focus();
  renderFixes();
  flash("correction ajoutée");
}

// --------------------------------------------------------------------------- //
//  Dicter dans l'onglet courant
// --------------------------------------------------------------------------- //
async function toggleInTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    // Enregistrement en cours -> on envoie un arret franc, pas un basculement :
    // si l'etat a bouge entre l'affichage et le clic, on ne relance pas une
    // capture par erreur.
    const recording = await refreshTabState();
    await chrome.tabs.sendMessage(tab.id, { type: recording ? "stop" : "toggle" });
    window.close();
  } catch {
    setStatus("Onglet non pris en charge — ouvre DeepSeek ou DeepSeek Harness", "bad");
  }
}

// --------------------------------------------------------------------------- //
//  Branchements
// --------------------------------------------------------------------------- //
$("toggle").addEventListener("click", toggleInTab);
$("addFix").addEventListener("click", addFix);
$("heard").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addFix(); } });
$("fixed").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addFix(); } });

for (const id of ["autoInsert", "showPartial", "beep", "stopOnHide"]) {
  $(id).addEventListener("change", async (e) => {
    settings[id] = e.target.checked;
    await chrome.storage.sync.set({ [id]: e.target.checked });
    flash("enregistré");
  });
}

let vocabTimer = null;
$("vocabulary").addEventListener("input", (e) => {
  clearTimeout(vocabTimer);
  vocabTimer = setTimeout(async () => {
    settings.vocabulary = e.target.value.trim();
    await chrome.storage.sync.set({ vocabulary: settings.vocabulary });
    flash("enregistré");
  }, 600);
});

$("options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

load();
