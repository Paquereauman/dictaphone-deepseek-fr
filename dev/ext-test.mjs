/**
 * Test de bout en bout de l'EXTENSION, sans intervention manuelle.
 *
 *  - lance un Chrome isole sur une instance de test du GUI Harness ;
 *  - charge l'extension via le domaine CDP Extensions (Chrome 13x+) ;
 *  - branche tests/test-fr.wav comme faux microphone (--use-file-for-fake-audio-capture) ;
 *  - clique le bouton micro de l'extension ;
 *  - verifie que le texte reconnu arrive DANS le composer Lexical.
 *
 *   $env:TARGET="http://127.0.0.1:3099/?token=..."
 *   node dev/ext-test.mjs <dossier-extension>
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9300 + Math.floor(Math.random() * 500);
const URL_TARGET = process.env.TARGET || "http://127.0.0.1:3080";
const EXT = resolve(ROOT, process.argv[2] || "extension");
const WAV = resolve(ROOT, process.argv[3] || "tests/test-fr.wav");
// "text"   : le texte doit rester dans le composer (defaut)
// "submit" : la commande "valider" doit declencher l'envoi (Entree)
// "stop"   : la commande "stop" doit arreter la dictee sans envoyer
const EXPECT = process.env.EXPECT || "text";
const NEEDLE = process.env.NEEDLE || "bonjour";

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
if (!existsSync(WAV)) throw new Error(`wav introuvable: ${WAV}`);

const profile = mkdtempSync(join(tmpdir(), "dsd-ext-"));
const args = [
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
  `--use-file-for-fake-audio-capture=${WAV}%noloop`,
  URL_TARGET,
];

console.log("Chrome  :", CHROME);
console.log("Port    :", PORT);
console.log("Ext     :", EXT);
console.log("Micro   :", WAV);

const chrome = spawn(CHROME, args, { stdio: "ignore" });

class Session {
  constructor(ws, label = "") {
    this.ws = ws;
    this.label = label;
    this.seq = 0;
    this.pending = new Map();
    this.events = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (process.env.VERBOSE) console.log(`   [${this.label}] ${msg.method}`,
          JSON.stringify(msg.params).slice(0, 300));
      }
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout ${method}`));
        }
      }, 40000);
    });
  }
}

async function openSession(wsUrl, label) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error(`connexion ${label} refusee`));
  });
  return new Session(ws, label);
}

async function httpJson(path) {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return r.json();
}

let browser = null;
let page = null;
let exitCode = 1;

try {
  // --- attendre Chrome ------------------------------------------------ //
  let version = null;
  for (let i = 0; i < 60 && !version; i += 1) {
    version = await httpJson("/json/version").catch(() => null);
    if (!version) await sleep(400);
  }
  if (!version) throw new Error("Chrome n'a pas demarre");
  console.log("Version :", version.Browser);
  browser = await openSession(version.webSocketDebuggerUrl, "browser");

  // --- charger l'extension -------------------------------------------- //
  console.log("\n=== Chargement de l'extension (CDP Extensions.loadUnpacked) ===");
  const loaded = await browser
    .send("Extensions.loadUnpacked", { path: EXT })
    .catch(async (e) => {
      console.log("  loadUnpacked indisponible :", e.message);
      const domains = await browser.send("Schema.getDomains").catch(() => ({ domains: [] }));
      const has = domains.domains?.some((d) => d.name === "Extensions");
      console.log("  domaine Extensions present :", Boolean(has));
      return null;
    });
  if (loaded) console.log("  extension chargee, id =", loaded.id);

  // --- trouver l'onglet ------------------------------------------------ //
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    const list = await httpJson("/json/list").catch(() => []);
    target = list.find((t) => t.type === "page" && t.url?.includes("127.0.0.1"));
    if (!target) await sleep(400);
  }
  if (!target) throw new Error("aucun onglet sur l'instance de test");
  page = await openSession(target.webSocketDebuggerUrl, "page");
  await page.send("Runtime.enable");
  await page.send("Page.enable");

  const evaluate = async (expression) => {
    const res = await page.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || "exception");
    return res.result.value;
  };

  // Rechargement : l'onglet a ete ouvert AVANT le chargement de l'extension,
  // son content script vit donc dans un contexte invalide.
  console.log("   rechargement de la page pour un contexte d'extension propre...");
  await page.send("Page.reload", { ignoreCache: true });
  await sleep(1500);

  // --- attendre le composer ------------------------------------------- //
  for (let i = 0; i < 60; i += 1) {
    if (await evaluate(`Boolean(document.querySelector('[data-composer-input]'))`).catch(() => false)) break;
    await sleep(500);
  }

  console.log("\n=== 1. Content script injecte ? ===");
  const injected = await evaluate(`(() => {
    const h = document.getElementById('dsd-dictaphone-host');
    return { host: Boolean(h), shadow: Boolean(h && h.shadowRoot),
             fab: Boolean(h && h.shadowRoot && h.shadowRoot.querySelector('.fab:not(.gear)')) };
  })()`);
  console.log(JSON.stringify(injected));
  if (!injected.fab) throw new Error("le bouton micro n'est pas present dans la page");

  console.log("\n=== 1b. Service worker + acces reseau ===");
  const targets = await httpJson("/json/list");
  const swTarget =
    targets.find((t) => t.type === "service_worker" && loaded && t.url.includes(loaded.id)) ||
    targets.find((t) => t.type === "service_worker" && t.url.includes("background.js"));
  console.log("   SW :", swTarget ? swTarget.url : "(aucun)");

  let swSession = null;
  const swLogs = [];
  if (swTarget) {
    swSession = await openSession(swTarget.webSocketDebuggerUrl, "sw");
    await swSession.send("Runtime.enable");
    await swSession.send("Log.enable");
    const poll = setInterval(() => {
      for (const ev of swSession.events.splice(0)) {
        if (ev.method === "Runtime.consoleAPICalled") {
          swLogs.push(`[${ev.params.type}] ` + ev.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
        } else if (ev.method === "Runtime.exceptionThrown") {
          swLogs.push("[EXCEPTION] " + (ev.params.exceptionDetails?.exception?.description || "?"));
        } else if (ev.method === "Log.entryAdded") {
          swLogs.push(`[log:${ev.params.entry.level}] ${ev.params.entry.text}`);
        }
      }
    }, 250);
    swSession._poll = poll;
    const swInfo = await swSession.send("Runtime.evaluate", {
      expression: `(async () => {
        const info = { nom: chrome.runtime.getManifest().name };
        try {
          const ws = new WebSocket('ws://127.0.0.1:8765/ws');
          await new Promise((res, rej) => {
            ws.onopen = res; ws.onerror = () => rej(new Error('onerror'));
            setTimeout(() => rej(new Error('timeout 5s')), 5000);
          });
          info.websocket = 'CONNEXION OK'; ws.close();
        } catch (e) { info.websocket = 'ECHEC: ' + e.message; }
        return info;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    console.log("   " + JSON.stringify(swInfo.result?.value ?? swInfo));
  }

  // Capture aussi la console de la page (content script).
  await page.send("Log.enable");
  const pageLogs = [];
  const pagePoll = setInterval(() => {
    for (const ev of page.events.splice(0)) {
      if (ev.method === "Runtime.consoleAPICalled") {
        pageLogs.push(`[${ev.params.type}] ` + ev.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
      } else if (ev.method === "Runtime.exceptionThrown") {
        pageLogs.push("[EXCEPTION] " + (ev.params.exceptionDetails?.exception?.description || "?"));
      } else if (ev.method === "Log.entryAdded") {
        pageLogs.push(`[log:${ev.params.entry.level}] ${ev.params.entry.text}`);
      }
    }
  }, 250);

  // Etat du WS cote serveur : on recharge la page pour repartir proprement.
  globalThis.__dumpLogs = () => {
    clearInterval(pagePoll);
    if (swSession?._poll) clearInterval(swSession._poll);
    console.log("\n--- console du service worker ---");
    console.log(swLogs.length ? swLogs.map((l) => "   " + l).join("\n") : "   (vide)");
    console.log("--- console de la page ---");
    console.log(pageLogs.length ? pageLogs.map((l) => "   " + l).join("\n") : "   (vide)");
  };

console.log("\n=== 2. Etat du serveur avant dictee ===");
  const before = await (await fetch("http://127.0.0.1:8765/health")).json();
  console.log(`   device=${before.device} modele=${before.model} appels=${before.total_calls}`);

  if (process.env.PRESET && swSession) {
    // Simule ce qu'un utilisateur vient de saisir dans le popup / les options.
    const res = await swSession.send("Runtime.evaluate", {
      expression: `(async () => { await chrome.storage.sync.set(${process.env.PRESET}); return true; })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    console.log("   Reglages precharges :", JSON.stringify(process.env.PRESET), "->", res.result?.value);
    await sleep(400);
  }

  console.log("\n=== 2b. Test du micro brut (hors extension) ===");
  const mic = await evaluate(`(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext({ sampleRate: 16000 });
    if (ctx.state === 'suspended') await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    const sp = ctx.createScriptProcessor(2048, 1, 1);
    let samples = 0, peak = 0, callbacks = 0, sq = 0;
    sp.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      samples += d.length; callbacks += 1;
      for (let i = 0; i < d.length; i += 4) { peak = Math.max(peak, Math.abs(d[i])); sq += d[i] * d[i]; }
    };
    const sink = ctx.createGain(); sink.gain.value = 0;
    src.connect(sp); sp.connect(sink); sink.connect(ctx.destination);
    await new Promise((r) => setTimeout(r, 3000));
    const out = { samples, callbacks, peak: Number(peak.toFixed(3)),
                  rms: Number(Math.sqrt(sq / Math.max(1, samples / 4)).toFixed(4)),
                  ctxState: ctx.state, sampleRate: ctx.sampleRate,
                  tracks: stream.getAudioTracks().map((t) => t.label) };
    try { stream.getTracks().forEach((t) => t.stop()); ctx.close(); } catch (e) {}
    return out;
  })()`);
  console.log(JSON.stringify(mic, null, 2));

  console.log("\n=== 3. Clic sur le bouton micro ===");
  await evaluate(`document.getElementById('dsd-dictaphone-host').shadowRoot.querySelector('.fab:not(.gear)').click(); true`);
  await sleep(2500);
  const listening = await evaluate(`(() => {
    const h = document.getElementById('dsd-dictaphone-host').shadowRoot;
    const fab = h.querySelector('.fab:not(.gear)');
    const bubble = h.querySelector('.bubble');
    return { classes: fab.className, title: fab.title,
             bulle: bubble.hidden ? null : bubble.textContent.slice(0, 120) };
  })()`);
  console.log(JSON.stringify(listening, null, 2));

  console.log("\n=== 4. Parole (faux micro) -> transcription -> composer ===");
  const readState = async () => {
    const t = await evaluate(`document.querySelector('[data-composer-input]').textContent`);
    const s = await evaluate(`window.__dsdTest ? JSON.parse(JSON.stringify({
      enters: window.__dsdTest.enters, undos: window.__dsdTest.undos,
      inserts: window.__dsdTest.inserts, last: window.__dsdTest.last })) : null`);
    return { texte: t, etat: s };
  };

  let texte = "";
  let testState = null;
  for (let i = 0; i < 22; i += 1) {
    await sleep(1000);
    const r = await readState();
    texte = r.texte;
    testState = r.etat;
    if (EXPECT === "submit" && testState && testState.enters >= 1) break;
    if (EXPECT !== "submit" && new RegExp(NEEDLE, "i").test(texte)) break;
  }
  console.log("   Composer  :", JSON.stringify(texte));
  if (testState) {
    console.log("   Diagnostic:", JSON.stringify({
      enters: testState.enters, undos: testState.undos,
      inserts: testState.inserts, last: testState.last,
    }));
  }

  const health = await (await fetch("http://127.0.0.1:8765/health")).json();
  console.log(`   Serveur  : appels=${health.total_calls} (avant ${before.total_calls})`);
  console.log(`   Audio recu: ${JSON.stringify(health.stats)}`);
  globalThis.__texte = texte;
  globalThis.__testState = testState;

console.log("\n=== 5. Arret de la dictee ===");
  await evaluate(`document.getElementById('dsd-dictaphone-host').shadowRoot.querySelector('.fab:not(.gear)').click(); true`);
  await sleep(3000);
  const after = await evaluate(`(() => {
    const h = document.getElementById('dsd-dictaphone-host').shadowRoot;
    return { classes: h.querySelector('.fab:not(.gear)').className,
             composer: document.querySelector('[data-composer-input]').textContent };
  })()`);
  console.log(JSON.stringify(after, null, 2));

  console.log("\n=== 6. Nettoyage ===");
  await evaluate(`(() => {
    const el = document.querySelector('[data-composer-input]');
    el.focus();
    const s = window.getSelection(); const r = document.createRange();
    r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r);
    document.execCommand('delete'); return el.textContent;
  })()`);

  const texteFinal = globalThis.__texte || "";
  const etat = globalThis.__testState;
  const texteEtTest = (etat?.last || "") + " " + texteFinal;
  let ok;
  if (EXPECT === "submit") {
    ok = Boolean(etat && etat.enters >= 1) && new RegExp(NEEDLE, "i").test(texteEtTest);
  } else if (EXPECT === "stop") {
    ok = new RegExp(NEEDLE, "i").test(texteFinal) && (!etat || etat.enters === 0);
  } else {
    ok = new RegExp(NEEDLE, "i").test(texteFinal);
  }
  ok = ok && health.total_calls > before.total_calls;

  exitCode = ok ? 0 : 1;
  console.log("\n" + "=".repeat(62));
console.log(`  Attendu (${EXPECT}, "${NEEDLE}") : ` + (ok ? "OK" : "ECHEC"));
  console.log("=".repeat(62));
} catch (err) {
  console.error("\nERREUR :", err.message);
  exitCode = 1;
} finally {
  try { globalThis.__dumpLogs?.(); } catch { /* ignore */ }
  try { page?.ws.close(); } catch { /* ignore */ }
  try { browser?.ws.close(); } catch { /* ignore */ }
  if (chrome.pid) {
    try { spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* ignore */ }
  }
  await killProfile(profile);
  await sleep(1500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  // Exit explicite : des handles de WebSocket / de processus enfant gardent
  // sinon la boucle d'evenements en vie et le script ne rend jamais la main.
  process.exit(exitCode);
}
