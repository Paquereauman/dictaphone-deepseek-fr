/**
 * Test CDP : verifie que l'injection de texte fonctionne dans le composer
 * Lexical de DeepSeek Harness, sans avoir a cliquer dans le navigateur.
 *
 * Lance un Chrome isole (profil temporaire) sur http://127.0.0.1:3080, puis
 * pilote la page via le protocole DevTools.
 *
 *   node dev/cdp-test.mjs
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9300 + Math.floor(Math.random() * 500);
const URL_TARGET = process.env.TARGET || "http://127.0.0.1:3080";
const EXT = process.argv[2] || ""; // chemin de l'extension a charger (optionnel)

const profile = mkdtempSync(join(tmpdir(), "dsd-chrome-"));
const args = [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  "--remote-allow-origins=*",
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
];
if (EXT) args.push(`--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`);
args.push(URL_TARGET);

console.log("Chrome :", CHROME);
console.log("Profil :", profile);
console.log("URL    :", URL_TARGET);
if (EXT) console.log("Ext    :", EXT);

const chrome = spawn(CHROME, args, { stdio: "ignore", detached: false });
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

let ws = null;
let seq = 0;
let exitCode = 1;
const pending = new Map();

function cdp(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout ${method}`));
      }
    }, 30000);
  });
}

async function waitForPage(timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === "page" && t.url && !t.url.startsWith("chrome"));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      /* Chrome n'ecoute pas encore */
    }
    await sleep(400);
  }
  throw new Error("Aucun onglet DevTools trouve");
}

async function evalInPage(expression, awaitPromise = false) {
  const res = await cdp("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
    userGesture: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || "exception dans la page");
  }
  return res.result.value;
}

try {
  const page = await waitForPage();
  console.log("Onglet  :", page.url.slice(0, 90));

  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("connexion CDP refusee"));
  });
  await cdp("Runtime.enable");
  await cdp("Page.enable");

  // Laisse l'application se monter.
  for (let i = 0; i < 40; i += 1) {
    const ready = await evalInPage(
      `Boolean(document.querySelector('[data-composer-input]'))`,
    ).catch(() => false);
    if (ready) break;
    await sleep(500);
  }

  console.log("\n=== 1. Presence du composer ===");
  const found = await evalInPage(`(() => {
    const el = document.querySelector('[data-composer-input]');
    if (!el) {
      return { ok: false, editeurs: document.querySelectorAll('[contenteditable]').length,
               body: document.body.innerText.slice(0, 200) };
    }
    const r = el.getBoundingClientRect();
    return { ok: true, tag: el.tagName, contenteditable: el.contentEditable,
             visible: r.width > 0 && r.height > 0, w: Math.round(r.width), h: Math.round(r.height),
             lexical: Boolean(el.__lexicalEditor),
             role: el.getAttribute('role') };
  })()`);
  console.log(JSON.stringify(found, null, 2));
  if (!found.ok) throw new Error("Composer [data-composer-input] introuvable");

  console.log("\n=== 2. Injection via execCommand('insertText') ===");
  const inject = await evalInPage(`(() => {
    const el = document.querySelector('[data-composer-input]');
    el.focus();
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);

    const probe = sel.getRangeAt(0).cloneRange();
    let beforeText = '';
    try { probe.setStart(el, 0); beforeText = probe.toString(); } catch (e) { beforeText = '<erreur>'; }

    const payload = (beforeText && !/\\s$/.test(beforeText) ? ' ' : '') + 'Texte dicte par le microphone.';
    const ok = document.execCommand('insertText', false, payload);
    return { ok, payload, beforeText: beforeText.slice(-40), domText: el.textContent };
  })()`);
  console.log(JSON.stringify(inject, null, 2));

  console.log("\n=== 3. Deuxieme injection (placement du curseur) ===");
  const inject2 = await evalInPage(`(() => {
    const el = document.querySelector('[data-composer-input]');
    el.focus();
    const sel = window.getSelection();
    const probe = sel.getRangeAt(0).cloneRange();
    let beforeText = '';
    try { probe.setStart(el, 0); beforeText = probe.toString(); } catch (e) { beforeText = '<erreur>'; }
    const payload = (beforeText && !/\\s$/.test(beforeText) ? ' ' : '') + 'Deuxieme phrase.';
    const ok = document.execCommand('insertText', false, payload);
    return { ok, payload, domText: el.textContent };
  })()`);
  console.log(JSON.stringify(inject2, null, 2));

  console.log("\n=== 4. Etat interne de Lexical ===");
  const lexical = await evalInPage(`(() => {
    const el = document.querySelector('[data-composer-input]');
    const ed = el.__lexicalEditor;
    if (!ed) return { disponible: false };
    let texte = null;
    ed.getEditorState().read(() => {
      const root = ed._headless ? null : null;
      texte = ed.getRootElement() ? ed.getRootElement().textContent : null;
    });
    return { disponible: true, rootText: texte,
             paragraphes: el.querySelectorAll('p').length,
             texteBrut: el.textContent };
  })()`);
  console.log(JSON.stringify(lexical, null, 2));

  console.log("\n=== 5. Content script de l'extension ===");
  const extCheck = await evalInPage(`(() => {
    const host = document.getElementById('dsd-dictaphone-host');
    return {
      injecte: Boolean(host),
      shadow: host ? Boolean(host.shadowRoot) : false,
      bouton: host && host.shadowRoot ? Boolean(host.shadowRoot.querySelector('.fab:not(.gear)')) : false,
    };
  })()`);
  console.log(JSON.stringify(extCheck, null, 2));

  console.log("\n=== 6. Nettoyage du composer ===");
  const cleared = await evalInPage(`(() => {
    const el = document.querySelector('[data-composer-input]');
    el.focus();
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(r);
    document.execCommand('delete');
    return el.textContent;
  })()`);
  console.log("Composer vide :", JSON.stringify(cleared));

  const verdict = inject.ok && /Texte dicte/.test(inject.domText || "");
  console.log("\n" + "=".repeat(60));
  console.log(verdict ? "  VERDICT : INJECTION FONCTIONNELLE (OK)" : "  VERDICT : ECHEC");
  console.log("=".repeat(60));
  exitCode = verdict ? 0 : 1;
} catch (err) {
  console.error("\nERREUR :", err.message);
  exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  // taskkill /T : Chrome est un arbre de processus, kill() ne tue que le lanceur.
  if (chrome.pid) {
    try {
      spawn("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
    } catch { /* ignore */ }
  }
  await killProfile(profile);
  await sleep(1500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  // Exit explicite : des handles de WebSocket / de processus enfant gardent
  // sinon la boucle d'evenements en vie.
  process.exit(exitCode);
}
