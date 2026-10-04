/**
 * Test du popup de l'extension, dans un Chrome isole.
 *
 *  - charge l'extension via CDP Extensions.loadUnpacked ;
 *  - ouvre chrome-extension://<id>/popup.html ;
 *  - verifie l'absence d'erreur JS et l'etat du serveur ;
 *  - ajoute une correction puis verifie qu'elle est bien enregistree.
 *
 *   node dev/popup-test.mjs <dossier-extension>
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9300 + Math.floor(Math.random() * 500);
const EXT = resolve(process.argv[2] || "extension");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Tue tous les Chrome du profil temporaire.
 * `taskkill` sur le lanceur ne suffit pas : Chrome s'en detache aussitot et les
 * processus survivent, ce qui finit par saturer la machine.
 */
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
if (!existsSync(EXT)) throw new Error(`extension introuvable: ${EXT}`);

const profile = mkdtempSync(join(tmpdir(), "dsd-popup-"));
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
    "about:blank",
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
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: res, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
        return;
      }
      if (msg.method === "Runtime.consoleAPICalled") {
        this.logs.push(`[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
      } else if (msg.method === "Runtime.exceptionThrown") {
        this.logs.push("[EXCEPTION] " + (msg.params.exceptionDetails?.exception?.description || "?"));
      } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        this.logs.push("[erreur] " + msg.params.entry.text);
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
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return r.json();
}

let browser = null;
let popup = null;
let exitCode = 1;

try {
  let version = null;
  for (let i = 0; i < 60 && !version; i += 1) {
    version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null);
    if (!version) await sleep(400);
  }
  if (!version) throw new Error("Chrome n'a pas demarre");
  browser = await open(version.webSocketDebuggerUrl, "browser");

  console.log("Chargement de l'extension…");
  const loaded = await browser.send("Extensions.loadUnpacked", { path: EXT });
  console.log("  id =", loaded.id);
  await sleep(800);

  const url = `chrome-extension://${loaded.id}/popup.html`;
  await browser.send("Target.createTarget", { url });
  await sleep(2500);

  const target = (await listTargets()).find((t) => t.url === url);
  if (!target) throw new Error("popup introuvable dans les cibles");

  popup = await open(target.webSocketDebuggerUrl, "popup");
  await popup.send("Runtime.enable");
  await popup.send("Log.enable");
  await popup.send("Page.enable");

  const evaluate = async (expression) => {
    const res = await popup.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || "exception");
    return res.result.value;
  };

  console.log("\n=== 1. Rendu du popup ===");
  const ui = await evaluate(`(() => ({
    titre: document.querySelector('h1')?.textContent.trim(),
    statut: document.getElementById('status').textContent,
    point: document.getElementById('dot').className,
    boutonDictee: document.getElementById('toggle').textContent,
    champs: document.querySelectorAll('input, textarea, button').length,
  }))()`);
  console.log(JSON.stringify(ui, null, 2));

  console.log("\n=== 2. Etat des corrections ===");
  await evaluate(`chrome.storage.sync.set({ replacements: {} })`);
  await evaluate(`location.reload()`);
  await sleep(1800);
  console.log("  vide :", await evaluate(`document.getElementById('emptyFixes').hidden ? 'message masque (anormal)' : 'message affiche (ok)'`));

  console.log("\n=== 3. Ajout d'une correction ===");
  await evaluate(`(async () => {
    document.getElementById('heard').value = 'dipsy';
    document.getElementById('fixed').value = 'DeepSeek';
    document.getElementById('addFix').click();
    await new Promise(r => setTimeout(r, 400));
    return true;
  })()`);
  const stored = await evaluate(`new Promise(r => chrome.storage.sync.get({replacements:{}}, v => r(v.replacements)))`);
  const chips = await evaluate(`document.querySelectorAll('#chips .chip').length`);
  console.log("  stocké :", JSON.stringify(stored));
  console.log("  puces  :", chips);

  console.log("\n=== 4. Vocabulaire ===");
  await evaluate(`(async () => {
    const t = document.getElementById('vocabulary');
    t.value = 'MonProjet, Acme';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 900));
    return true;
  })()`);
  const vocab = await evaluate(`new Promise(r => chrome.storage.sync.get({vocabulary:''}, v => r(v.vocabulary)))`);
  console.log("  stocké :", JSON.stringify(vocab));

  console.log("\n=== 5. Erreurs JS ===");
  const errors = popup.logs.filter((l) => /EXCEPTION|\[erreur\]/.test(l));
  console.log(errors.length ? errors.map((l) => "  " + l).join("\n") : "  aucune");

  const ok =
    ui.point.includes("ok") &&
    Object.keys(stored).length === 1 &&
    stored.dipsy === "DeepSeek" &&
    chips === 1 &&
    vocab === "MonProjet, Acme" &&
    errors.length === 0;

  exitCode = ok ? 0 : 1;
  console.log("\n" + "=".repeat(58));
  console.log(ok ? "  POPUP FONCTIONNEL ✅" : "  POPUP EN ECHEC ❌");
  console.log("=".repeat(58));
} catch (err) {
  console.error("\nERREUR :", err.message);
  exitCode = 1;
} finally {
  try { popup?.ws.close(); } catch { /* ignore */ }
  try { browser?.ws.close(); } catch { /* ignore */ }
  if (chrome.pid) {
    try { spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* ignore */ }
  }
  await killProfile(profile);
  await sleep(1500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(exitCode);
}
