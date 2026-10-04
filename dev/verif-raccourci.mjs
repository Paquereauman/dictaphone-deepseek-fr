/**
 * Verifie qu'un raccourci Windows peut ouvrir une page chrome-extension://
 * Chrome bloque certaines URLs en ligne de commande : on le teste vraiment.
 *
 *   1. lance un Chrome isole + charge l'extension ;
 *   2. relance chrome.exe avec la meme profil et l'URL chrome-extension://...
 *      (exactement ce que fait un double-clic sur le raccourci) ;
 *   3. regarde si la page est bien ouverte dans les cibles DevTools.
 *
 *   node dev/verif-raccourci.mjs <dossier-extension>
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

const profile = mkdtempSync(join(tmpdir(), "dsd-lnk-"));
const base = ["--headless=new", `--remote-debugging-port=${PORT}`, "--remote-allow-origins=*",
              `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check"];

const first = spawn(CHROME, [...base, process.env.STARTUP || "about:blank"], { stdio: "ignore" });
let exitCode = 1;

async function targets() {
  return fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).catch(() => []);
}

try {
  let version = null;
  for (let i = 0; i < 60 && !version; i += 1) {
    version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null);
    if (!version) await sleep(400);
  }
  if (!version) throw new Error("Chrome n'a pas demarre");

  const browser = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { browser.onopen = res; browser.onerror = () => rej(new Error("CDP refuse")); });
  let seq = 0;
  const pending = new Map();
  browser.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, { res, rej });
    browser.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(`timeout ${method}`)); } }, 20000);
  });

  const loaded = await send("Extensions.loadUnpacked", { path: EXT });
  const id = loaded.id;
  console.log("Extension chargee, id =", id);
  await sleep(1200);

  const url = process.argv[3] || `chrome-extension://${id}/options.html`;
  console.log("\nOuverture de l'onglet :", url);

  // On ouvre l'onglet via CDP dans l'instance en cours : en headless, un second
  // processus chrome.exe ne transmet pas l'URL a la premiere instance.
  await send("Target.createTarget", { url });
  await sleep(4500);

  const list = await targets();
  const triggerTab = list.find((t) => t.type === "page" && t.url.startsWith(url.split("?")[0]));
  const optionsTab = list.find((t) => t.type === "page" && t.url.startsWith(`chrome-extension://${id}/options.html`));
  console.log("\nOnglets ouverts :");
  for (const t of list) console.log(`  - ${t.type.padEnd(12)} ${(t.url || "").slice(0, 80)}`);

  console.log("\n  page declencheuse ouverte :", Boolean(triggerTab));
  console.log("  page de reglages ouverte  :", Boolean(optionsTab));

  if (optionsTab) {
    console.log("\n  => la page de REGLAGES de l'extension s'est bien ouverte");
    exitCode = 0;
  } else {
    console.log("\n  => la page de reglages ne s'est PAS ouverte");
  }
  browser.close();
} catch (err) {
  console.error("ERREUR :", err.message);
  exitCode = 1;
} finally {
  for (const pid of [first.pid]) {
    try { spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* ignore */ }
  }
  await killProfile(profile);
  await sleep(1500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(exitCode);
}
