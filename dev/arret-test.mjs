/**
 * Test de l'ARRET de la dictee — reproduit le bug « on ne peut plus arreter ».
 *
 * Scenario d'origine : une erreur (reseau ou transcription) remettait
 * l'interface en veille SANS fermer le micro. Le clic suivant ouvrait une
 * deuxieme capture, et la premiere devenait impossible a arreter.
 *
 * Le test mesure le nombre de pistes micro REELLEMENT ouvertes, grace a une
 * instrumentation de getUserMedia dans la page de diagnostic.
 *
 *   node dev/arret-test.mjs <dossier-extension>
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9300 + Math.floor(Math.random() * 500);
const EXT = resolve(process.argv[2] || "extension");
const PAGE = process.env.PAGE || "http://127.0.0.1:8765/extension-test";
const GOOD_SERVER = "http://127.0.0.1:8765";
const BAD_SERVER = "http://127.0.0.1:9"; // personne n'ecoute sur ce port

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!existsSync(EXT)) throw new Error(`extension introuvable: ${EXT}`);

async function killProfile(profilePath) {
  const cmd = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${profilePath}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  await new Promise((resolve) => {
    try {
      const proc = spawn("powershell", ["-NoProfile", "-Command", cmd], { stdio: "ignore" });
      proc.on("exit", resolve);
      proc.on("error", resolve);
      setTimeout(resolve, 8000);
    } catch {
      resolve();
    }
  });
}

const profile = mkdtempSync(join(tmpdir(), "dsd-stop-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    PAGE,
  ],
  { stdio: "ignore" },
);

class Session {
  constructor(ws, label = "") {
    this.ws = ws;
    this.label = label;
    this.seq = 0;
    this.pending = new Map();
    this.logs = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve: res, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : res(m.result);
        return;
      }
      if (m.method === "Runtime.exceptionThrown") {
        this.logs.push("[EXCEPTION] " + (m.params.exceptionDetails?.exception?.description || "?"));
      }
    };
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(`timeout ${method}`)); }
      }, 30000);
    });
  }
}

async function open(wsUrl, label) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error(`connexion ${label} refusee`)); });
  return new Session(ws, label);
}

async function listTargets() {
  return fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).catch(() => []);
}

let browser = null;
let page = null;
let sw = null;
let exitCode = 1;
const results = [];
let evaluate = null;

function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  console.log(`  [${condition ? "ok   " : "ECHEC"}] ${name}${detail !== undefined ? "  — " + detail : ""}`);
}

const SHADOW = `document.getElementById('dsd-dictaphone-host').shadowRoot`;

async function clickMic() {
  return evaluate(`${SHADOW}.querySelector('.fab:not(.gear)').click(); true`);
}

async function state() {
  // L'extension expose son etat interne sur son element hote : content script
  // et page vivent dans des mondes JS separes, la page ne peut donc pas
  // instrumenter getUserMedia elle-meme.
  return evaluate(`(() => {
    const host = document.getElementById('dsd-dictaphone-host');
    const h = host.shadowRoot;
    return {
      mics: Number(host.dataset.dsdMic || 0),
      requests: Number(host.dataset.dsdOpened || 0),
      etat: host.dataset.dsdState,
      rec: h.querySelector('.fab:not(.gear)').classList.contains('rec'),
      titre: h.querySelector('.fab:not(.gear)').title,
      bulle: h.querySelector('.bubble').hidden ? '' : h.querySelector('.bubble').textContent.slice(0, 100),
    };
  })()`);
}

async function pressEscape() {
  const base = { windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27, key: "Escape", code: "Escape" };
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

async function setServer(url) {
  const res = await sw.send("Runtime.evaluate", {
    expression: `(async () => { await chrome.storage.sync.set({ serverUrl: ${JSON.stringify(url)} }); return true; })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  return res.result?.value;
}

async function reloadPage() {
  await page.send("Page.reload", { ignoreCache: true });
  for (let i = 0; i < 40; i += 1) {
    await sleep(400);
    const ok = await evaluate(`Boolean(document.getElementById('dsd-dictaphone-host') && document.querySelector('[data-composer-input]'))`).catch(() => false);
    if (ok) return true;
  }
  return false;
}

try {
  let version = null;
  for (let i = 0; i < 60 && !version; i += 1) {
    version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null);
    if (!version) await sleep(400);
  }
  if (!version) throw new Error("Chrome n'a pas demarre");
  browser = await open(version.webSocketDebuggerUrl, "browser");
  const loaded = await browser.send("Extensions.loadUnpacked", { path: EXT });
  console.log("Extension :", loaded.id, "\n");
  await sleep(800);

  const targets = await listTargets();
  const pageTarget = targets.find((t) => t.type === "page" && t.url.includes("127.0.0.1"));
  const swTarget = targets.find((t) => t.type === "service_worker" && t.url.includes("background.js"));
  if (!pageTarget) throw new Error("onglet de diagnostic introuvable");
  if (!swTarget) throw new Error("service worker introuvable");

  page = await open(pageTarget.webSocketDebuggerUrl, "page");
  sw = await open(swTarget.webSocketDebuggerUrl, "sw");
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await sw.send("Runtime.enable");

  evaluate = async (expression) => {
    const res = await page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || "exception");
    return res.result.value;
  };

  await setServer(GOOD_SERVER);
  if (!(await reloadPage())) throw new Error("page de diagnostic non chargee");

  // --- 1. demarrage + arret par Echap ------------------------------------ //
  console.log("=== 1. Demarrage puis arret par Echap ===");
  await clickMic();
  await sleep(2500);
  let s = await state();
  console.log("   ", JSON.stringify(s));
  check("le micro s'ouvre (1 piste)", s.mics === 1, `mics=${s.mics}`);
  check("le bouton passe en ecoute", s.rec === true);
  check("le titre annonce l'arret", /ARRETER/i.test(s.titre || ""), JSON.stringify(s.titre));

  await pressEscape();
  await sleep(1500);
  s = await state();
  console.log("   ", JSON.stringify(s));
  check("Echap libere le micro", s.mics === 0, `mics=${s.mics}`);
  check("l'interface repasse en veille", s.rec === false);

  // --- 2. redemarrage : aucune capture ne doit s'accumuler --------------- //
  console.log("\n=== 2. Redemarrage ===");
  await clickMic();
  await sleep(2500);
  s = await state();
  console.log("   ", JSON.stringify(s));
  check("une seule piste apres redemarrage", s.mics === 1, `mics=${s.mics}`);
  check("exactement 2 ouvertures depuis le debut", s.requests === 2, `requests=${s.requests}`);

  // --- 3. arret par clic sur le bouton ----------------------------------- //
  console.log("\n=== 3. Arret par clic sur le bouton ===");
  await clickMic();
  await sleep(1500);
  s = await state();
  console.log("   ", JSON.stringify(s));
  check("le clic libere le micro", s.mics === 0, `mics=${s.mics}`);
  check("l'interface repasse en veille", s.rec === false);

  // --- 4. LE BUG : erreur pendant l'ecoute ------------------------------- //
  console.log("\n=== 4. Erreur serveur pendant l'ecoute (le bug d'origine) ===");
  await setServer(BAD_SERVER);
  if (!(await reloadPage())) throw new Error("rechargement impossible");
  const before = (await state()).requests;
  await clickMic();
  await sleep(6000); // le temps que la WebSocket echoue et que l'erreur remonte
  s = await state();
  console.log("   ", JSON.stringify(s));
  check("l'erreur affiche un message", /joindre|impossible|erreur|serveur/i.test(s.bulle || ""), JSON.stringify(s.bulle));
  check("l'interface repasse en veille", s.rec === false);
  check("AUCUN micro reste ouvert apres l'erreur", s.mics === 0, `mics=${s.mics}`);

  // --- 5. apres l'erreur, on doit pouvoir repartir proprement ------------ //
  console.log("\n=== 5. Retour a la normale ===");
  await setServer(GOOD_SERVER);
  if (!(await reloadPage())) throw new Error("rechargement impossible");
  await clickMic();
  await sleep(2500);
  s = await state();
  console.log("   ", JSON.stringify(s));
  check("une seule piste apres reprise", s.mics === 1, `mics=${s.mics}`);
  check("aucune capture fantome accumulee", s.requests === 1, `requests=${s.requests} (attendu 1 sur cette page)`, );
  await pressEscape();
  await sleep(1200);
  s = await state();
  check("et on peut encore arreter", s.mics === 0, `mics=${s.mics}`);

  const failed = results.filter((r) => !r.ok);
  exitCode = failed.length ? 1 : 0;
  console.log("\n" + "=".repeat(62));
  console.log(`  ${results.length - failed.length}/${results.length} verifications OK ` + (failed.length ? "— ECHECS" : ""));
  if (failed.length) failed.forEach((f) => console.log("    - " + f.name));
  console.log("=".repeat(62));
} catch (err) {
  console.error("\nERREUR :", err.message);
  exitCode = 1;
} finally {
  try { page?.ws.close(); } catch { /* ignore */ }
  try { sw?.ws.close(); } catch { /* ignore */ }
  try { browser?.ws.close(); } catch { /* ignore */ }
  if (chrome.pid) {
    try { spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* ignore */ }
  }
  await killProfile(profile);
  await sleep(1500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(exitCode);
}
