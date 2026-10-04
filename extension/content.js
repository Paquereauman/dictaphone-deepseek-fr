/**
 * Dictaphone FR — content script.
 *
 * S'injecte dans DeepSeek (chat.deepseek.com), dans l'application PWA DeepSeek,
 * dans DeepSeek Harness (127.0.0.1:3080) et dans sa version navigateur.
 *
 * - capture le micro (PCM 16 kHz mono) et l'envoie au service worker ;
 * - affiche un bouton micro flottant + un apercu du texte en cours ;
 * - ecrit le texte reconnu dans le composer (contenteditable Lexical, textarea
 *   ou input) via execCommand('insertText'), ce que Lexical ecoute nativement.
 */
(() => {
  const MARK = "__dsDictaphoneInjected";
  if (window[MARK]) return;
  window[MARK] = true;

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
    // Garde-fous d'arret
    stopOnHide: true,
    maxMinutes: 5,
  };

  const SR = 16000;
  let settings = { ...DEFAULTS };
  let state = "idle"; // idle | starting | listening | stopping
  let port = null;
  let audio = null; // {ctx, stream, src, worklet, sp, sink}
  let lastPartial = "";
  let ui = null;
  let captureToken = 0; // invalide un demarrage en cours si on arrete entre-temps
  let maxTimer = null;
  // Compteurs de captures micro : ouvrables en lecture depuis la page via
  // data-dsd-mic. Un ecart qui ne retombe pas a 0 = micro fantome.
  let streamsOpened = 0;
  let streamsClosed = 0;

  // ----------------------------------------------------------------------- //
  //  Styles + interface (Shadow DOM : insensible au CSS de la page)
  // ----------------------------------------------------------------------- //
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap {
      position: fixed;
      display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
      font: 13px/1.45 "Segoe UI", system-ui, -apple-system, sans-serif;
      color: #e7e9ee;
      pointer-events: none;
    }
    .bubble {
      pointer-events: auto;
      max-width: 420px; min-width: 180px;
      background: rgba(18,21,27,.94);
      backdrop-filter: blur(14px);
      border: 1px solid rgba(255,255,255,.10);
      border-radius: 14px;
      padding: 10px 14px;
      box-shadow: 0 12px 32px rgba(0,0,0,.45);
      color: #cfd4de;
      font-style: italic;
      max-height: 150px; overflow: auto;
      transition: opacity .15s;
    }
    .bubble b { color: #fff; font-style: normal; font-weight: 600; }
    .bubble .err { color: #ff8b7a; font-style: normal; }
    .bubble[hidden] { display: none; }

    .row { display: flex; align-items: center; gap: 8px; pointer-events: none; }

    .fab {
      pointer-events: auto;
      position: relative;
      width: 52px; height: 52px; border-radius: 50%;
      border: 1px solid rgba(255,255,255,.12);
      background: linear-gradient(180deg, #232a36, #171b23);
      color: #e7e9ee; cursor: pointer;
      display: grid; place-items: center;
      box-shadow: 0 10px 26px rgba(0,0,0,.5);
      transition: transform .12s, background .18s, box-shadow .18s;
      user-select: none; touch-action: none;
      padding: 0;
    }
    .fab:hover { transform: translateY(-1px); background: linear-gradient(180deg, #2b3341, #1c212a); }
    .fab:active { transform: scale(.96); }
    .fab svg { width: 24px; height: 24px; display: block; }
    .fab.gear { width: 38px; height: 38px; box-shadow: 0 8px 20px rgba(0,0,0,.45); }
    .fab.gear svg { width: 18px; height: 18px; }
    .fab.rec {
      background: linear-gradient(180deg, #e0574a, #c0392b);
      border-color: rgba(255,255,255,.28);
      box-shadow: 0 0 0 0 rgba(224,87,74,.55), 0 10px 26px rgba(0,0,0,.5);
      animation: pulse 1.6s ease-out infinite;
    }
    .fab.busy { background: linear-gradient(180deg, #d6a63c, #b8860b); }
    @keyframes pulse {
      0%   { box-shadow: 0 0 0 0 rgba(224,87,74,.55), 0 10px 26px rgba(0,0,0,.5); }
      100% { box-shadow: 0 0 0 18px rgba(224,87,74,0), 0 10px 26px rgba(0,0,0,.5); }
    }

    .hint {
      pointer-events: none;
      background: rgba(18,21,27,.9);
      border: 1px solid rgba(255,255,255,.08);
      color: #8b93a3; border-radius: 8px; padding: 4px 9px; font-size: 11px;
      white-space: nowrap;
    }
    .hint[hidden] { display: none; }

    .meter { width: 4px; height: 52px; border-radius: 4px; background: rgba(255,255,255,.08); overflow: hidden; display: flex; align-items: flex-end; }
    .meter[hidden] { display: none; }
    .meter i { display: block; width: 100%; height: 0%; background: linear-gradient(180deg,#e74c3c,#f1c40f,#2ecc71); transition: height .08s linear; }
  `;

  const MIC_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="2" width="6" height="12" rx="3"></rect>
    <path d="M5 11a7 7 0 0 0 14 0"></path>
    <line x1="12" y1="18" x2="12" y2="22"></line>
    <line x1="8" y1="22" x2="16" y2="22"></line>
  </svg>`;

  const STOP_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="2.5"></rect>
  </svg>`;

  const GEAR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3.2"></circle>
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.1 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03z"></path>
  </svg>`;

  function buildUI() {
    if (ui) return ui;
    const host = document.createElement("div");
    host.id = "dsd-dictaphone-host";
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    wrap.innerHTML = `
      <div class="bubble" hidden></div>
      <div class="row">
        <div class="hint" hidden></div>
        <div class="meter" hidden><i></i></div>
        <button class="fab gear" type="button" title="Reglages de la dictee (vocabulaire, corrections, commandes)">${GEAR_SVG}</button>
        <button class="fab" type="button" title="Dicter — ${settings.shortcut}">${MIC_SVG}</button>
      </div>`;
    root.appendChild(wrap);
    document.documentElement.appendChild(host);

    ui = {
      host,
      wrap,
      bubble: root.querySelector(".bubble"),
      fab: root.querySelector(".fab:not(.gear)"),
      gear: root.querySelector(".fab.gear"),
      hint: root.querySelector(".hint"),
      meter: root.querySelector(".meter"),
      bar: root.querySelector(".meter i"),
    };
    applyPosition();
    ui.gear.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openOptions();
    });
    ui.fab.addEventListener("click", (e) => {
      if (Date.now() - (ui.lastDragEnd || 0) < 300) {
        e.preventDefault();
        return;
      }
      toggle();
    });
    makeDraggable();
    return ui;
  }

  function applyPosition() {
    if (!ui) return;
    ui.wrap.style.right = `${Number(settings.right) || 26}px`;
    ui.wrap.style.bottom = `${Number(settings.bottom) || 118}px`;
  }

  function makeDraggable() {
    const { fab, wrap } = ui;
    let startX = 0, startY = 0, origin = null, moved = false;

    fab.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const r = wrap.getBoundingClientRect();
      origin = { right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom };
      fab.setPointerCapture(e.pointerId);
    });

    fab.addEventListener("pointermove", (e) => {
      if (!origin || !fab.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      settings.right = Math.max(4, origin.right - dx);
      settings.bottom = Math.max(4, origin.bottom - dy);
      applyPosition();
    });

    fab.addEventListener("pointerup", (e) => {
      try { fab.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (moved) {
        ui.lastDragEnd = Date.now();
        chrome.storage.sync.set({ right: Math.round(settings.right), bottom: Math.round(settings.bottom) });
      }
      origin = null;
    });
  }

  // ----------------------------------------------------------------------- //
  //  Retour visuel
  // ----------------------------------------------------------------------- //
  function setState(next) {
    state = next;
    const u = buildUI();
    const listening = next === "listening";
    // Le bouton devient un CARRE D'ARRET pendant l'ecoute : l'action
    // disponible doit etre evidente.
    u.fab.innerHTML = listening ? STOP_SVG : MIC_SVG;
    u.fab.classList.toggle("rec", listening);
    u.fab.classList.toggle("busy", next === "starting" || next === "stopping");
    u.fab.title = listening
      ? "ARRETER la dictee (Echap ou clic)"
      : `Dicter — ${settings.shortcut}`;
    u.meter.hidden = !listening;
    if (!listening) u.bar.style.height = "0%";

    if (listening) {
      clearTimeout(setState._hint);
      u.hint.textContent = "REC — Echap pour arreter";
      u.hint.hidden = false;
    } else if (!setState._hintLocked) {
      clearTimeout(setState._hint);
      setState._hint = setTimeout(() => { if (state !== "listening") u.hint.hidden = true; }, 1200);
    }

    if (next === "idle") {
      setTimeout(() => {
        if (state === "idle" && !bubbleSticky) {
          u.bubble.hidden = true;
          u.bubble.innerHTML = "";
        }
      }, 900);
    }
    syncDebug();
  }

  /** Reflete l'etat interne dans le DOM : diagnostic sans outil externe. */
  function syncDebug() {
    if (!ui) return;
    try {
      ui.host.dataset.dsdState = state;
      ui.host.dataset.dsdMic = String(Math.max(0, streamsOpened - streamsClosed));
      ui.host.dataset.dsdOpened = String(streamsOpened);
    } catch { /* ignore */ }
  }

  let bubbleSticky = false;

  function showBubble(html, sticky) {
    const u = buildUI();
    u.bubble.innerHTML = html;
    u.bubble.hidden = false;
    bubbleSticky = Boolean(sticky);
    clearTimeout(showBubble._t);
    if (!sticky) {
      showBubble._t = setTimeout(() => {
        if (state === "idle" && !bubbleSticky) u.bubble.hidden = true;
      }, 3500);
    }
  }

  function showError(message) {
    // Ne JAMAIS afficher une erreur en laissant le micro ouvert : la capture
    // deviendrait orpheline et impossible a arreter.
    stopCapture("erreur", { quiet: true });
    showBubble(`<span class="err">${escapeHtml(message)}</span>`, true);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /**
   * Ouvre la page de reglages de l'extension.
   *
   * Chrome interdit d'ouvrir une URL chrome-extension:// depuis un raccourci
   * Windows (elle est remplacee par un nouvel onglet). Le seul chemin fiable
   * passe donc par l'extension elle-meme : ce bouton, le popup, ou la page
   * locale /reglages qui nous envoie un message.
   */
  function openOptions() {
    try {
      // openOptionsPage() n'existe pas dans un content script : on delegue au
      // service worker (voir background.js).
      chrome.runtime.sendMessage({ type: "open-options" }, () => {
        if (chrome.runtime.lastError) {
          showBubble(`<span class="err">Reglages inaccessibles : ${escapeHtml(chrome.runtime.lastError.message)}</span>`, true);
        }
      });
      showBubble("<b>Reglages</b> — ouverture dans un nouvel onglet");
      return true;
    } catch (e) {
      showBubble(`<span class="err">Reglages inaccessibles : ${escapeHtml(String(e))}</span>`, true);
      return false;
    }
  }

  /** ArrayBuffer -> base64 (les messages d'extension sont serialises en JSON). */
  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function beep(freq, ms) {
    if (!settings.beep) return;
    try {
      const ctx = audio?.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      g.gain.value = 0.0001;
      osc.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime;
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      osc.start(t);
      osc.stop(t + ms / 1000 + 0.02);
      if (!audio) setTimeout(() => ctx.close?.(), ms + 120);
    } catch {
      /* le son est un bonus */
    }
  }

  // ----------------------------------------------------------------------- //
  //  Ecriture dans le composer
  // ----------------------------------------------------------------------- //
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  function findComposer() {
    const selectors = [
      "[data-composer-input]",              // DeepSeek Harness (Lexical)
      'div[contenteditable="true"][role="textbox"]',
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"]',
      "textarea#chat-input",
      "textarea",
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (isVisible(el) && !el.disabled && !el.readOnly) return el;
      }
    }
    return null;
  }

  function insertText(text) {
    const el = findComposer();
    if (!el) return false;

    try { el.focus({ preventScroll: false }); } catch { el.focus(); }

    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const s = el.selectionStart ?? el.value.length;
      const e = el.selectionEnd ?? s;
      let payload = text;
      if (s > 0 && !/\s$/.test(el.value.slice(0, s))) payload = " " + payload;
      el.setRangeText(payload, s, e, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    const sel = window.getSelection();
    if (!sel) return false;

    if (!sel.rangeCount || !el.contains(sel.anchorNode)) {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }

    let payload = text;
    try {
      const probe = sel.getRangeAt(0).cloneRange();
      probe.setStart(el, 0);
      const before = probe.toString();
      if (before && !/\s$/.test(before)) payload = " " + payload;
    } catch {
      /* position indeterminee : on insere tel quel */
    }

    let ok = false;
    try {
      ok = document.execCommand("insertText", false, payload);
    } catch {
      ok = false;
    }

    if (!ok) {
      // Repli : insertion DOM brute + evenements d'entree (fonctionne encore
      // sur les contenteditable non geres par un framework).
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(payload);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: payload }));
    }
    return true;
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  // ----------------------------------------------------------------------- //
  //  Commandes vocales (« valider », « stop », « a la ligne »...)
  // ----------------------------------------------------------------------- //
  const COMMAND_LABELS = {
    submit: "Valider — envoi du message",
    stop: "Arrêter la dictée",
    newline: "Nouvelle ligne",
    cancel: "Annuler le texte dicté",
    undo: "Effacer le dernier morceau",
  };

  function dispatchKey(el, init) {
    const opts = { bubbles: true, cancelable: true, composed: true, ...init };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function findSendButton() {
    const selectors = [
      '[data-testid*="send" i]',
      'button[aria-label*="envoy" i]',
      'button[aria-label*="send" i]',
      'button[title*="envoy" i]',
      'button[title*="send" i]',
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (isVisible(el) && !el.disabled) return el;
      }
    }
    return null;
  }

  /** Envoie le message : touche Entree, puis repli sur le bouton d'envoi. */
  async function submitComposer() {
    const el = findComposer();
    if (!el) return false;
    try { el.focus({ preventScroll: false }); } catch { el.focus(); }
    const before = (el.textContent || "").trim();
    dispatchKey(el, { key: "Enter", code: "Enter", keyCode: 13, which: 13 });
    await new Promise((r) => setTimeout(r, 350));
    const after = (findComposer()?.textContent || "").trim();
    if (after !== before && after.length < before.length) return true;
    const btn = findSendButton();
    if (btn) { btn.click(); return true; }
    return false;
  }

  /** Annule la derniere insertion. Lexical ecoute Ctrl+Z, pas execCommand. */
  function undoComposer() {
    const el = findComposer();
    if (!el) return false;
    try { el.focus({ preventScroll: false }); } catch { el.focus(); }
    dispatchKey(el, { key: "z", code: "KeyZ", keyCode: 90, which: 90, ctrlKey: true });
    try { return document.execCommand("undo") || true; } catch { return true; }
  }

  async function handleCommand(m) {
    const name = m.name;
    const label = COMMAND_LABELS[name] || name;
    console.debug("[dictaphone] commande vocale :", name, "— entendu:", m.heard);
    showBubble(`<b>${escapeHtml(label)}</b>`);

    switch (name) {
      case "submit":
        stop();
        await new Promise((r) => setTimeout(r, 450)); // laisse arriver un dernier morceau
        if (!(await submitComposer())) {
          showBubble('<span class="err">Je n\'ai pas trouvé le bouton d\'envoi. Appuie sur Entrée.</span>', true);
        }
        break;

      case "stop":
        stop();
        break;

      case "cancel":
        undoComposer();
        stop();
        break;

      case "undo":
        undoComposer();
        break;

      case "newline":
        insertText("\n");
        break;

      default:
        break;
    }
  }

  // ----------------------------------------------------------------------- //
  //  Capture micro
  // ----------------------------------------------------------------------- //
  async function openMicrophone() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const ctx = new AudioContext({ sampleRate: SR });
    // Chrome peut demarrer l'AudioContext en "suspended" (politique autoplay,
    // ou onglet en arriere-plan) : sans resume, aucun echantillon n'arrive.
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch { /* ignore */ }
    }
    const src = ctx.createMediaStreamSource(stream);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);

    const audio_ = { ctx, stream, src, sink, worklet: null, sp: null };
    let sent = 0;
    const emit = (buf) => {
      sent += 1;
      if (sent === 1 || sent % 40 === 0) {
        console.debug(`[dictaphone] audio: ${sent} blocs de ${buf.byteLength} octets — port: ${Boolean(port)}`);
      }
      if (port) {
        try {
          // IMPORTANT : la messagerie content script <-> service worker passe
          // par JSON. Un ArrayBuffer y devient {} et l'audio serait perdu :
          // on encode donc en base64.
          port.postMessage({ cmd: "audio", b64: toBase64(buf), size: buf.byteLength });
        } catch (e) {
          console.debug("[dictaphone] envoi audio impossible:", String(e));
        }
      }
      drawLevel(buf);
    };

    let worklet = null;
    try {
      await ctx.audioWorklet.addModule(chrome.runtime.getURL("pcm-worklet.js"));
      worklet = new AudioWorkletNode(ctx, "pcm-worklet");
      worklet.port.onmessage = (ev) => emit(ev.data);
      src.connect(worklet);
      worklet.connect(sink);
      audio_.worklet = worklet;
      console.debug("[dictaphone] capture via AudioWorklet");
    } catch (err) {
      // CSP de la page trop stricte, ou AudioWorklet indisponible -> repli.
      console.debug("[dictaphone] AudioWorklet indisponible, repli ScriptProcessor :", String(err));
      const sp = ctx.createScriptProcessor(2048, 1, 1);
      sp.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i += 1) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        emit(pcm.buffer);
      };
      src.connect(sp);
      sp.connect(sink);
      audio_.sp = sp;
    }
    streamsOpened += 1;
    syncDebug();
    return audio_;
  }

  function drawLevel(buffer) {
    if (!ui || state !== "listening") return;
    const pcm = new Int16Array(buffer);
    if (!pcm.length) return;
    let sum = 0;
    for (let i = 0; i < pcm.length; i += 4) {
      const v = pcm[i] / 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / (pcm.length / 4));
    ui.bar.style.height = `${Math.min(100, rms * 330).toFixed(0)}%`;
  }

  function closeAudio(a) {
    if (!a) return;
    streamsClosed += 1;
    syncDebug();
    try { a.worklet?.port.close(); } catch { /* ignore */ }
    try { a.worklet?.disconnect(); } catch { /* ignore */ }
    if (a.sp) { try { a.sp.onaudioprocess = null; a.sp.disconnect(); } catch { /* ignore */ } }
    try { a.src.disconnect(); } catch { /* ignore */ }
    try { a.sink.disconnect(); } catch { /* ignore */ }
    try { a.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { a.ctx?.close(); } catch { /* ignore */ }
  }

  function closeMicrophone() {
    const a = audio;
    audio = null;
    closeAudio(a);
  }

  /**
   * Point de sortie UNIQUE de l'ecoute : ferme le micro, previent le serveur,
   * repasse l'interface en veille.
   *
   * C'est ce qui manquait : une erreur reseau ou de transcription remettait
   * l'interface en veille en laissant le micro ouvert. Le demarrage suivant
   * ouvrait alors une DEUXIEME capture, et la premiere — devenue orpheline —
   * ne pouvait plus etre arretee.
   */
  function stopCapture(reason, { notify = true, quiet = false } = {}) {
    const wasActive = state !== "idle" || Boolean(audio);
    captureToken += 1; // invalide tout demarrage encore en cours
    clearTimeout(maxTimer);
    closeMicrophone();
    if (notify && wasActive) {
      try { port?.postMessage({ cmd: "stop" }); } catch { /* ignore */ }
    }
    if (!quiet) console.debug("[dictaphone] arret :", reason);
    setState("idle");
    setBadge(false);
    return wasActive;
  }

  /** Garde-fous : duree maximale, onglet masque. */
  function startWatchdogs() {
    clearTimeout(maxTimer);
    const minutes = Number(settings.maxMinutes) || 0;
    if (minutes > 0) {
      maxTimer = setTimeout(() => {
        if (state === "listening") {
          showBubble("<b>Arrêt automatique</b> — durée maximale atteinte");
          stopCapture("duree maximale");
        }
      }, minutes * 60 * 1000);
    }
  }

  /** Pastille "REC" sur l'icone de l'extension, visible meme bouton masque. */
  function setBadge(recording) {
    try {
      chrome.runtime.sendMessage({ type: "badge", recording: Boolean(recording) }, () => {
        void chrome.runtime.lastError;
      });
    } catch { /* ignore */ }
  }

  // ----------------------------------------------------------------------- //
  //  Connexion au service worker
  // ----------------------------------------------------------------------- //
  function ensurePort() {
    if (port) return port;
    port = chrome.runtime.connect({ name: "dictation" });
    port.onMessage.addListener(onBackgroundMessage);
    port.onDisconnect.addListener(() => {
      port = null;
      if (state !== "idle") {
        closeMicrophone();
        showError("Connexion au service de dictee perdue. Reclique sur le micro pour repartir.");
      }
    });
    port.postMessage({ cmd: "connect" });
    return port;
  }

  function onBackgroundMessage(msg) {
    if (!msg) return;
    if (msg.type === "socket") {
      if (msg.state === "error") showError(msg.message || "Serveur de dictee injoignable.");
      return;
    }
    if (msg.type !== "server") return;
    const m = msg.payload || {};
    switch (m.type) {
      case "ready":
        showBubble(`<b>Moteur prêt</b> — ${escapeHtml(m.model)} / ${escapeHtml(m.device)}`);
        break;
      case "partial":
        lastPartial = m.text || "";
        if (settings.showPartial && lastPartial) {
          showBubble(`… ${escapeHtml(lastPartial)}`);
        }
        break;
      case "final":
        handleFinal(m);
        break;
      case "command":
        handleCommand(m);
        break;
      case "error":
        showError(m.message || "Erreur de transcription.");
        break;
      case "done":
        stopCapture("fin", { notify: false });
        break;
      default:
        break;
    }
  }

  async function handleFinal(m) {
    lastPartial = "";
    const text = (m.text || "").trim();
    if (!text) {
      if (state === "listening" && ui) ui.bubble.hidden = true;
      return;
    }
    if (settings.autoInsert) {
      if (insertText(text)) {
        showBubble(`<b>${escapeHtml(text)}</b>`);
        return;
      }
      const copied = await copyToClipboard(text);
      showBubble(
        copied
          ? `Composer introuvable. Texte copié dans le presse-papier :<br><b>${escapeHtml(text)}</b>`
          : `Composer introuvable. Texte :<br><b>${escapeHtml(text)}</b>`,
        true,
      );
      return;
    }
    const copied = await copyToClipboard(text);
    showBubble(
      copied ? `Copié dans le presse-papier :<br><b>${escapeHtml(text)}</b>` : `<b>${escapeHtml(text)}</b>`,
    );
  }

  // ----------------------------------------------------------------------- //
  //  Demarrage / arret
  // ----------------------------------------------------------------------- //
  async function start() {
    if (state !== "idle") return;
    if (audio) closeMicrophone(); // securite : jamais deux captures a la fois
    setState("starting");
    buildUI();
    const token = ++captureToken;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Micro inaccessible : la page doit être en HTTPS ou sur 127.0.0.1.");
      }
      ensurePort();
      ui.bubble.hidden = true;
      const opened = await openMicrophone();
      // Un arret (ou une erreur) est survenu pendant l'ouverture du micro :
      // on jette la capture au lieu de la laisser orpheline.
      if (token !== captureToken) {
        closeAudio(opened);
        return;
      }
      audio = opened;
      lastPartial = "";
      // Le focus doit etre dans le composer pour que le texte arrive au bon endroit.
      if (settings.autoInsert) {
        const el = findComposer();
        if (el) { try { el.focus({ preventScroll: false }); } catch { el.focus(); } }
        else showBubble("Composer introuvable : le texte sera copié dans le presse-papier.", true);
      }
      setState("listening");
      setBadge(true);
      startWatchdogs();
      beep(880, 90);
    } catch (err) {
      closeMicrophone();
      showError(
        err?.name === "NotAllowedError"
          ? "Accès au micro refusé. Autorise le microphone pour ce site (icône dans la barre d'adresse)."
          : String(err?.message || err),
      );
    }
  }

  /** Arrete l'ecoute. Toujours possible, quel que soit l'etat. */
  function stop() {
    if (state === "idle" && !audio) return;
    beep(520, 70);
    stopCapture("arret demande");
  }

  /** Arrete l'ecoute et annule le texte du dernier morceau. */
  function cancel() {
    if (state === "idle" && !audio) return;
    undoComposer();
    try { port?.postMessage({ cmd: "reset" }); } catch { /* ignore */ }
    beep(360, 70);
    stopCapture("annulation");
  }

  function toggle() {
    if (state === "idle") start();
    else stop();
  }

  // ----------------------------------------------------------------------- //
  //  Raccourcis clavier
  // ----------------------------------------------------------------------- //
  function keyName(e) {
    if (e.code === "Space") return "space";
    if (e.code === "Escape") return "escape";
    if (e.code?.startsWith("Key")) return e.code.slice(3).toLowerCase();
    if (e.code?.startsWith("Digit")) return e.code.slice(5);
    return (e.code || e.key || "").toLowerCase();
  }

  function matchesShortcut(e) {
    const parts = String(settings.shortcut || DEFAULTS.shortcut)
      .split("+")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!parts.length) return false;
    const wantKey = parts[parts.length - 1];
    const want = {
      ctrl: parts.includes("ctrl") || parts.includes("control"),
      shift: parts.includes("shift"),
      alt: parts.includes("alt"),
      meta: parts.includes("meta") || parts.includes("cmd") || parts.includes("win"),
    };
    if (!!e.ctrlKey !== want.ctrl) return false;
    if (!!e.shiftKey !== want.shift) return false;
    if (!!e.altKey !== want.alt) return false;
    if (!!e.metaKey !== want.meta) return false;
    return keyName(e) === wantKey;
  }

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.repeat) return;
      if (e.key === "Escape" && (state === "listening" || state === "starting")) {
        e.preventDefault();
        e.stopPropagation();
        cancel();
        return;
      }
      if (matchesShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }
    },
    true,
  );

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg) return false;
    if (msg.type === "toggle") {
      toggle();
      reply({ ok: true, state });
      return false;
    }
    if (msg.type === "stop") {
      stop();
      reply({ ok: true, state });
      return false;
    }
    if (msg.type === "state") {
      // Le popup s'en sert pour afficher « Arreter » au lieu de « Dicter ».
      reply({ ok: true, state, recording: state !== "idle" || Boolean(audio) });
      return false;
    }
    if (msg.type === "open-options") {
      openOptions();
      return false;
    }
    return false;
  });

  // Garde-fou : onglet masque (changement d'onglet, fenetre minimisee).
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && settings.stopOnHide && (state === "listening" || state === "starting")) {
      stopCapture("onglet masque");
    }
  });

  // Dernier filet : la page disparait.
  window.addEventListener("pagehide", () => stopCapture("page fermee", { quiet: true }));

  // La page locale du serveur (/reglages) ne peut pas ouvrir une URL
  // chrome-extension:// elle-meme : elle nous le demande, ou l'indique dans
  // l'URL. Restreint au serveur de dictee pour eviter tout declenchement
  // depuis un site tiers.
  (function wireOptionsTrigger() {
    const local = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && location.port === "8765";
    if (!local) return;
    let done = false;
    const once = () => { if (!done) { done = true; openOptions(); } };
    window.addEventListener("message", (event) => {
      if (event.source === window && event.data && event.data.dsd === "open-options") once();
    });
    if (new URLSearchParams(location.search).get("open") === "options") setTimeout(once, 250);
  })();

  // ----------------------------------------------------------------------- //
  //  Config
  // ----------------------------------------------------------------------- //
  function loadSettings(then) {
    chrome.storage.sync.get(DEFAULTS, (v) => {
      settings = { ...DEFAULTS, ...v };
      then?.();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const k of Object.keys(changes)) settings[k] = changes[k].newValue;
    applyPosition();
    // Ne pas ecraser le libelle d'arret pendant une ecoute.
    if (ui && state !== "listening") ui.fab.title = `Dicter — ${settings.shortcut}`;
  });

  loadSettings(() => {
    buildUI();
    applyPosition();
    setState("idle");
    chrome.storage.sync.get({ showHint: true }, (v) => {
      if (v.showHint) {
        const u = buildUI();
        // Verrouille le libelle pendant l'affichage du rappel : sinon le
        // minuteur de setState("idle") le masque aussitot.
        setState._hintLocked = true;
        u.hint.textContent = `Dicter : ${settings.shortcut}`;
        u.hint.hidden = false;
        setTimeout(() => {
          setState._hintLocked = false;
          if (state !== "listening") u.hint.hidden = true;
        }, 5000);
      }
    });
  });
})();
