/**
 * Extension Dictaphone FR — service worker.
 *
 * Role : posseder la connexion WebSocket vers le serveur local (le service
 * worker d'extension n'est pas soumis au CSP de la page, contrairement au
 * content script) et faire le relais entre le micro (content script) et le
 * serveur de transcription.
 */

const DEFAULTS = {
  serverUrl: "http://127.0.0.1:8765",
  language: "fr",
  model: "",
  autoInsert: true,
  showPartial: true,
  beep: true,
  // Reglages pousses au serveur a chaque session : modifier une correction ou
  // un mot du vocabulaire prend effet immediatement, sans redemarrer le serveur.
  vocabulary: "",
  replacements: {},
  voiceCommands: null,
  cleanup: null,
  // Garde-fous d'arret (lus par le content script)
  stopOnHide: true,
  maxMinutes: 5,
};

let settings = { ...DEFAULTS };

function refreshSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (v) => {
      settings = { ...DEFAULTS, ...v };
      resolve(settings);
    });
  });
}

refreshSettings();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" || area === "local") refreshSettings();
});
chrome.runtime.onInstalled.addListener(refreshSettings);
chrome.runtime.onStartup.addListener(refreshSettings);

// --------------------------------------------------------------------------- //
//  Relais WebSocket <-> content script
// --------------------------------------------------------------------------- //
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "dictation") return;
  console.debug("[dictaphone] port connecte");

  let ws = null;
  let queue = [];
  let opened = false;

  const post = (msg) => {
    try {
      port.postMessage(msg);
    } catch {
      /* le content script est parti */
    }
  };

  const send = (obj) => {
    const raw = JSON.stringify(obj);
    if (opened && ws && ws.readyState === WebSocket.OPEN) ws.send(raw);
    else queue.push(raw);
  };

  // Les premieres trames audio arrivent souvent avant que la WebSocket soit
  // ouverte : on les met en attente au lieu de les perdre.
  let audioFrames = 0;
  const sendAudio = (buf) => {
    audioFrames += 1;
    if (audioFrames === 1 || audioFrames % 40 === 0) {
      console.debug(`[dictaphone] relais audio: ${audioFrames} trames (${buf.length ?? buf.byteLength} o)`);
    }
    if (opened && ws && ws.readyState === WebSocket.OPEN) ws.send(buf);
    else if (queue.length < 400) queue.push(buf);
  };

  /** base64 -> Uint8Array (la messagerie d'extension serialise en JSON). */
  const fromBase64 = (text) => {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  };

  const flush = () => {
    if (!opened || !ws) return;
    while (queue.length) ws.send(queue.shift());
  };

  async function connect() {
    await refreshSettings();
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    const base = String(settings.serverUrl || DEFAULTS.serverUrl).trim().replace(/\/+$/, "");
    try {
      await fetch(base + "/health", { signal: AbortSignal.timeout(800) });
    } catch {
      await new Promise((res) => {
        try {
          chrome.runtime.sendNativeMessage("com.dictaphone.launcher", { cmd: "start" }, () => {
            void chrome.runtime.lastError;
            res();
          });
        } catch {
          res();
        }
      });
    }
    const wsUrl = base.replace(/^http/i, "ws") + "/ws";
    console.debug("[dictaphone] connexion a", wsUrl);
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      console.debug("[dictaphone] WebSocket refuse:", err);
      post({ type: "socket", state: "error", message: String(err) });
      return;
    }
    ws.onopen = () => {
      opened = true;
      console.debug("[dictaphone] WebSocket ouverte");
      post({ type: "socket", state: "open", url: wsUrl });
      send({
        type: "start",
        language: settings.language || "fr",
        model: settings.model || undefined,
        vocabulary: settings.vocabulary || undefined,
        replacements: Object.keys(settings.replacements || {}).length ? settings.replacements : undefined,
        voice_commands: settings.voiceCommands || undefined,
        cleanup: settings.cleanup || undefined,
      });
      flush();
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      console.debug("[dictaphone] recu", msg.type);
      post({ type: "server", payload: msg });
    };
    ws.onerror = (ev) => {
      console.debug("[dictaphone] erreur WebSocket", ev);
      post({
        type: "socket",
        state: "error",
        message:
          "Impossible de joindre le serveur de dictée (" +
          base +
          "). Lance « start.bat » dans le dossier dictaphone.",
      });
    };
    ws.onclose = () => {
      console.debug("[dictaphone] WebSocket fermee");
      opened = false;
      ws = null;
      post({ type: "socket", state: "closed" });
    };
  }

  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.cmd !== "audio") console.debug("[dictaphone] commande", msg.cmd);
    switch (msg.cmd) {
      case "connect":
        connect();
        break;
      case "audio":
        try {
          if (typeof msg.b64 === "string") sendAudio(fromBase64(msg.b64));
          else if (msg.buf) sendAudio(msg.buf);
        } catch (e) {
          console.debug("[dictaphone] decodage audio impossible:", String(e));
        }
        break;
      case "stop":
        send({ type: "stop" });
        break;
      case "reset":
        queue = [];
        send({ type: "reset" });
        break;
      case "settings":
        refreshSettings();
        break;
      default:
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stop" }));
      ws && ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
    opened = false;
  });
});

// --------------------------------------------------------------------------- //
//  Reglages + pastille d'enregistrement
// --------------------------------------------------------------------------- //
// Un content script n'a PAS acces a chrome.runtime.openOptionsPage() : il doit
// passer par ici. C'est le seul chemin fiable, Chrome interdisant d'ouvrir une
// URL chrome-extension:// depuis un raccourci Windows.
const BADGE_COLOR = "#c0392b";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;

  if (msg.type === "open-options") {
    chrome.runtime
      .openOptionsPage()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.debug("[dictaphone] ouverture des reglages impossible:", String(err));
        sendResponse({ ok: false, error: String(err) });
      });
    return true; // reponse asynchrone
  }

  if (msg.type === "badge") {
    // Pastille « REC » : l'enregistrement reste visible meme si le bouton
    // flottant est masque par l'interface du site.
    try {
      chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
      chrome.action.setBadgeText({ text: msg.recording ? "REC" : "" });
    } catch (err) {
      console.debug("[dictaphone] pastille indisponible:", String(err));
    }
    return false;
  }

  return false;
});

// La pastille ne doit jamais rester bloquee apres un redemarrage du navigateur.
chrome.runtime.onStartup.addListener(() => chrome.action.setBadgeText({ text: "" }));
chrome.runtime.onInstalled.addListener(() => chrome.action.setBadgeText({ text: "" }));

// --------------------------------------------------------------------------- //
//  Raccourci global (chrome://extensions/shortcuts)
// --------------------------------------------------------------------------- //
chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== "toggle-dictation") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "toggle" });
  } catch {
    /* page sans content script */
  }
});

// Le clic sur l'icone ouvre desormais le popup (popup.html) : onClicked ne se
// declenche plus. Le bouton flottant et le raccourci clavier restent les moyens
// de demarrer une dictee depuis la page.
