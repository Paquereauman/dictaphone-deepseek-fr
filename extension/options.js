const DEFAULTS = {
  serverUrl: "http://127.0.0.1:8765",
  language: "fr",
  model: "",
  autoInsert: true,
  showPartial: true,
  beep: true,
  shortcut: "Ctrl+Shift+Space",
  bottom: 118,
  right: 26,
  stopOnHide: true,
  maxMinutes: 5,

  // Amelioration de la dictee
  vocabulary: "",
  corrections: "",      // une par ligne : "entendu = corrige"
  cmdSubmit: "valider, envoyer, envoie, envoie le message, vas-y, c'est bon",
  cmdStop: "stop, arrête, arrêter, arrête la dictée",
  wholeSegment: true,

  // Nettoyage
  frenchTypography: false,
  capitalize: true,
  removeFillers: true,

  // Table envoyee au serveur (derivee de `corrections`)
  replacements: {},
  voiceCommands: null,
  cleanup: null,
};

const FIELDS = [
  "serverUrl", "language", "model", "autoInsert",
  "showPartial", "beep", "shortcut", "bottom", "right",
  "stopOnHide", "maxMinutes",
  "vocabulary", "corrections", "cmdSubmit", "cmdStop", "wholeSegment",
  "frenchTypography", "capitalize", "removeFillers",
];

const $ = (id) => document.getElementById(id);
const status = $("status");

function setStatus(text, cls) {
  status.textContent = text;
  status.className = "status" + (cls ? " " + cls : "");
}

// --------------------------------------------------------------------------- //
//  Conversions texte <-> structures attendues par le serveur
// --------------------------------------------------------------------------- //
function parseCorrections(text) {
  const table = {};
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep < 0) continue;
    const from = line.slice(0, sep).trim().toLowerCase();
    const to = line.slice(sep + 1).trim();
    if (from) table[from] = to;
  }
  return table;
}

function formatCorrections(table) {
  return Object.entries(table || {})
    .map(([from, to]) => `${from} = ${to}`)
    .join("\n");
}

function parseWords(text) {
  return String(text || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function load() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  // Les corrections vivent dans `replacements` (partage avec le popup).
  stored.corrections = stored.corrections || formatCorrections(stored.replacements);

  for (const key of FIELDS) {
    const el = $(key);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = Boolean(stored[key]);
    else el.value = stored[key] ?? "";
  }

  // Les commandes vivent dans `voiceCommands` (partage avec le popup).
  const vc = stored.voiceCommands || {};
  if (Array.isArray(vc.submit) && vc.submit.length) $("cmdSubmit").value = vc.submit.join(", ");
  if (Array.isArray(vc.stop) && vc.stop.length) $("cmdStop").value = vc.stop.join(", ");
  if (typeof vc.whole_segment === "boolean") $("wholeSegment").checked = vc.whole_segment;

  setStatus("Prêt.");
}

function collect() {
  const out = {};
  for (const key of FIELDS) {
    const el = $(key);
    if (!el) continue;
    if (el.type === "checkbox") out[key] = el.checked;
    else if (el.type === "number") out[key] = Number(el.value) || DEFAULTS[key];
    else out[key] = el.value.trim();
  }
  if (!out.serverUrl) out.serverUrl = DEFAULTS.serverUrl;

  const replacements = parseCorrections(out.corrections);
  out.replacements = replacements;
  out.voiceCommands = {
    submit: parseWords(out.cmdSubmit),
    stop: parseWords(out.cmdStop),
    whole_segment: out.wholeSegment,
  };
  out.cleanup = {
    capitalize: out.capitalize,
    remove_fillers: out.removeFillers,
    french_typography: out.frenchTypography,
  };
  return out;
}

async function save() {
  const values = collect();
  await chrome.storage.sync.set(values);
  const fixes = Object.keys(values.replacements).length;
  setStatus(
    `Réglages enregistrés.\n${fixes} correction(s) personnelle(s), ` +
    `${values.voiceCommands.submit.length} mot(s) d'envoi, ${values.voiceCommands.stop.length} mot(s) d'arrêt.\n` +
    "Actif dès la prochaine dictée — aucun redémarrage nécessaire.",
    "ok",
  );
  if (values.model) {
    try {
      const r = await fetch(`${values.serverUrl.replace(/\/+$/, "")}/model?name=${encodeURIComponent(values.model)}`, { method: "POST" });
      const j = await r.json();
      setStatus(`Réglages enregistrés.\nModèle chargé : ${j.model} (${j.device} / ${j.compute_type})`, "ok");
    } catch {
      setStatus("Réglages enregistrés.\n(le serveur n'a pas pu précharger le modèle — est-il démarré ?)", "ok");
    }
  }
}

async function test() {
  const url = collect().serverUrl.replace(/\/+$/, "");
  setStatus("Test en cours…");
  try {
    const r = await fetch(`${url}/health`, { cache: "no-store" });
    const j = await r.json();
    const lines = [
      j.model_loaded
        ? "✔ Serveur joignable, modèle chargé"
        : "✔ Serveur joignable — modèle en attente (la 1re dictée prendra ~2 s)",
      `modèle     : ${j.model}`,
      `device     : ${j.device}  (${j.compute_type})`,
      `GPU        : ${j.gpu} — ${j.vram_total_mb} Mo`,
      `chargement : ${j.load_seconds} s`,
      `dernière   : ${j.last_infer_ms} ms pour ${j.last_audio_s} s d'audio`,
      `appels     : ${j.total_calls}`,
    ];
    setStatus(lines.join("\n"), "ok");
  } catch (e) {
    setStatus(
      "✘ Serveur injoignable sur " + url + "\n\n" +
      "→ Lance demarrage-auto.bat (ou start.bat) dans le dossier dictaphone\n" +
      "→ Attends le message « Pret. » dans la fenêtre noire.\n\n" + String(e),
      "bad",
    );
  }
}

$("save").addEventListener("click", save);
$("test").addEventListener("click", test);
load();
