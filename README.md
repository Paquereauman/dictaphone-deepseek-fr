# 🎙️ Dictaphone DeepSeek FR

**Free, local French voice dictation** for **DeepSeek**, **DeepSeek Harness** and their PWA apps.
You speak, the text types itself into the input box. Nothing leaves your computer: speech recognition runs locally on your **NVIDIA GPU** with Whisper.

> The dictation language is French. The extension interface and the voice commands are in French too (quoted below with their English meaning).

```
   mic  ──►  Chrome extension  ──►  local server (Whisper on GPU)  ──►  text in the composer
                (capture)               (transcription)                  (DeepSeek / Harness)
```

---

## 0. What was tested

Everything below was tested end to end on a Windows laptop with an RTX 4050 (6 GB), not just written:

| Check | Measured result |
|---|---|
| GPU used | `cuda` / `float16`, RTX 4050 Laptop, 6,141 MB |
| Speed | **9.5 s of audio transcribed in 243 ms, about 39× real time** |
| Model loading | 26 s the first time (download), **1.8 s** afterwards |
| Splitting at pauses | live partial text, then `FINAL` about 0.9 s after the pause |
| Injection into the Harness composer | ✅ internal state of the **Lexical** editor verified |
| Full chain extension → server → composer | ✅ OK |
| Voice commands ("Valider", "Stop") | ✅ tested end to end (real send, stop without sending) |
| Correction added live | ✅ applied without restarting the server |
| Extension popup | ✅ rendering, corrections, vocabulary, no JS error |
| Stopping dictation | ✅ 15/15: Esc, click, toggle, and **no ghost microphone** after an error |
| Silent auto-start | ✅ server online in 1.6 s, no duplicate |

The only known gap is the French word « dictée » sometimes written « dicte » (missing accent), typical of the `small` model. See §4 to switch to `medium`.

---

## 1. Requirements

| Item | Notes |
|---|---|
| Windows + Chrome | |
| NVIDIA GPU (6 GB or more recommended) + recent driver | CPU also works, much slower |
| Python 3.10+ | |
| About 1.8 GB of free disk space | for CUDA and the Whisper model |

---

## 2. Installation (once, about 5 minutes)

1. Double-click **`install.bat`**.
   It creates an isolated Python environment (`.venv`), installs `faster-whisper` and the CUDA libraries, then downloads the `small` model (about 480 MB).

2. Install the extension in Chrome:
   - open `chrome://extensions`
   - turn on **Developer mode** (top-right switch)
   - click **Load unpacked**
   - choose the **`extension`** folder of this project

3. Done. Move on to usage.

---

## 3. Usage

1. Double-click **`start.bat`**. A black window opens and shows `Pret.` (ready). Leave it open; close it to stop the server.
2. Open DeepSeek or DeepSeek Harness.
3. Put the cursor in the input box, then press **`Ctrl + Shift + Space`**.
4. **Speak normally.** Text is written sentence by sentence at each pause, with a grey live preview while you speak.
5. Press **`Ctrl + Shift + Space`** again to stop, or **`Esc`** at any time to cancel.

> 💡 You can also click the **floating microphone button** at the bottom right, or the extension icon in the toolbar. The button can be dragged with the mouse.

### Stopping dictation

Four equivalent ways:

| Way | When |
|---|---|
| **`Esc`** | Fastest, the page must have focus |
| **Click the floating button** | While listening, the microphone becomes a **red stop square** |
| **`Ctrl + Shift + Space`** | Start/stop toggle |
| **`Alt + Shift + D`** | Global extension shortcut (change it at `chrome://extensions/shortcuts`) |

While recording, three signs tell you it is running: the button becomes a red square, the label reads **REC — Esc to stop**, and a **REC** badge appears on the extension icon.

Two automatic safeguards, adjustable in **Options → Stop and safety**:

- **Stop when you switch tabs** or minimise the window (on by default).
- **Maximum duration** of a dictation, 5 minutes by default, so the microphone can never stay open indefinitely.

### Voice commands

Say the word **on its own**, after a pause, with nothing else in the sentence (the commands are French words):

| You say | Result |
|---|---|
| « Valider », « Envoyer », « C'est bon », « Vas-y » (confirm, send, OK, go) | **Sends the message** (Enter key) and stops dictation |
| « Stop », « Arrête la dictée », « Termine » (stop, finish) | Stops dictation **without** sending |
| « À la ligne », « Nouveau paragraphe » (new line, new paragraph) | Inserts a line break |
| « Annuler », « Efface », « Oublie » (undo, erase, forget) | Cancels what was just dictated |
| « Efface le dernier mot » (erase the last word) | Undoes the last inserted chunk |

The **whole-chunk rule** prevents false positives: saying « je vais valider le formulaire » ("I'm going to validate the form") sends nothing, because the command does not fill the whole chunk (chunks are the segments cut at your pauses). You can loosen this rule and change the words in the settings.

### Where it works

| Application | Status |
|---|---|
| DeepSeek Harness (PWA) | ✅ |
| DeepSeek (PWA) | ✅ |
| chat.deepseek.com in Chrome | ✅ |
| http://127.0.0.1:3080 in Chrome | ✅ |

---

## 3 bis. Automatic start (recommended)

Never think about `start.bat` again: double-click **`demarrage-auto.bat`** and choose **`1`**.

The server then starts **by itself, with no window**, each time you log in to Windows, so it is ready when you open DeepSeek.

| | |
|---|---|
| Cost when you are not dictating | about 60 MB of RAM, **0 MB of VRAM** |
| First dictation after startup | about 2 s to load the model, once |
| Log | `logs\serveur.log` |
| Turn off | run `demarrage-auto.bat` again → `2` |
| Check status | run `demarrage-auto.bat` again → `3` |

The model is **not** preloaded at startup, on purpose, so it does not hold 0.8 GB of VRAM all the time. If you prefer it warm from the start, set `"preload": true` in `config.json`.

`start.bat` stays useful to see live messages, change model from the command line, or dictate without waiting for the next login.

---

## 4. Settings

Right-click the extension icon → **Options**, or `chrome://extensions` → *Details* → *Extension options*.

- **Language**: French by default. Force `fr` for the best results (avoid "auto-detect" if you mostly dictate in French).
- **Whisper model**: see the table below.
- **Keyboard shortcut**: any combination, e.g. `Ctrl+Shift+Space`, `Alt+D`, `F9`.
- **Write directly into the input box**: untick to copy to the clipboard instead.
- **Live preview**: the grey bubble while you speak.
- **Position**: or simply drag the microphone button.

### Which model?

| Model | Size | VRAM | French quality | Speed (RTX 4050) |
|---|---|---|---|---|
| `tiny` | 75 MB | ~0.3 GB | ⭐ | instant |
| `base` | 145 MB | ~0.4 GB | ⭐⭐ | instant |
| **`small`** *(default)* | 480 MB | ~0.8 GB | ⭐⭐⭐ | ~15× real time |
| `medium` | 1.5 GB | ~1.8 GB | ⭐⭐⭐⭐ | ~6× real time |
| `large-v3-turbo` | 1.6 GB | ~2.0 GB | ⭐⭐⭐⭐⭐ | ~8× real time |

With 6 GB of VRAM, **`medium`** fits easily and is clearly better in French.
To change: Options → Model → *Save* (the server loads it live).

From the command line:

```bat
start.bat --model medium
start.bat --model large-v3-turbo
start.bat --cpu                  REM no GPU (much slower)
```

---

## 4 bis. Improving recognition of your words

Everything is set in `config.json`, then restart `start.bat`.

### 1. Vocabulary (most effective)

Whisper is **strongly influenced** by this text: the words you put there are recognised first. This is why it writes "DeepSeek" rather than "Dipsy et que".

```json
"vocabulary": "DeepSeek, DeepSeek Harness, Claude Code, ChatGPT, WebSocket, FastAPI, Python, Whisper, Chrome, Windows, API, extension."
```

Add your project names, client names and technical terms, but never go beyond about 40 words (the effect fades). Avoid isolated common words and labels like "Vocabulary:", which Whisper may echo back during a silent passage.

### 2. Replacements (the safety net)

To fix forms the model still produces:

```json
"cleanup": {
  "replacements": {
    "deep sea": "DeepSeek",
    "fast api": "FastAPI"
  }
}
```

### 3. From the extension button

Clicking the icon opens a **popup**: server status, a *Dictate in this tab* button, a two-field correction form and your vocabulary.

Anything you enter there (as in the settings page) takes effect **on the next dictation, without restarting the server**.

On the page, a **gear button** sits just left of the microphone and opens the settings directly, the shortest path while you are dictating.

### 4. Pauses

```json
"silence_ms": 700,
```
Length of silence that triggers writing a chunk. Lower it to `450` for a snappier rhythm, raise it to `1000` if you pause mid-sentence.

---

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| **"Impossible de joindre le serveur de dictée"** (cannot reach the dictation server) | `start.bat` is not running. Double-click it and wait for `Pret.` |
| **The microphone does not start** | Click the 🔒 / microphone icon in the address bar and allow the microphone for the site. |
| **Nothing is typed** | Check that the cursor is in the input box. Otherwise the text is copied to the clipboard (Ctrl+V). |
| **Slow** | Check the GPU: open <http://127.0.0.1:8765/health> → `"device": "cuda"`. If it says `cpu`, reinstall with `install.bat`. |
| **Accent or word errors** | Normal with the `small` model. Switch to `medium` or `large-v3-turbo` in the options. |
| **A technical word is misrecognised** | See §4 bis. |
| **"Le moteur n'a pas pu être chargé"** (engine could not be loaded) | Run `install.bat` again. Make sure the NVIDIA driver is up to date. |
| **The microphone stays stuck** | `Esc`, then click the floating button. In the console (F12) check `document.getElementById("dsd-dictaphone-host").dataset.dsdMic`: it must be `0` at rest. Otherwise reload the page (`F5`) and report it. |
| **Dictation does not stop when I change tab** | Options → Stop and safety → enable "Stop if I change tab". |
| **`Esc` does not stop it** | The page must have focus. Otherwise use `Alt + Shift + D`, which works while the Chrome window is active. |

Check the engine at any time: <http://127.0.0.1:8765/health>

---

## 6. Test pages and scripts

Without the extension, open <http://127.0.0.1:8765>: a page lets you test the microphone and transcription directly in the browser. Handy to isolate a problem (microphone vs extension vs server).

<http://127.0.0.1:8765/extension-test> simulates the DeepSeek input box: dictated text arrives there, but **nothing is sent to DeepSeek**. The page counts sends, cancellations and inserted chunks, ideal to check voice commands without triggering anything real.

### Diagnostic scripts

```bat
REM Checks the GPU, the VAD and transcribes tests\test-fr.wav
.venv\Scripts\python.exe tests\selftest.py small tests\test-fr.wav

REM Replays a WAV through the WebSocket, like the microphone does
.venv\Scripts\python.exe tests\streamtest.py tests\test-fr.wav

REM Checks voice commands and cleanup (no microphone)
.venv\Scripts\python.exe outils\test-commandes.py

REM Checks that the server responds
tests\tester.bat
```

The test files (`test-fr.wav`, `test-commande-envoi.wav`, `test-commande-stop.wav`) live in **`tests\`**. `test-fr.wav` is a French sample (Windows synthetic voice). The two command files contain a sentence followed by a command word, with the required pause.

The **`dev/`** folder holds the scripts used to validate the extension without manual clicks (an isolated Chrome driven through the DevTools protocol, with a WAV plugged in as a fake microphone):

```bash
node dev/cdp-test.mjs            # injection into the Harness Lexical composer
node dev/ext-test.mjs extension  # full chain, end to end
node dev/popup-test.mjs          # popup: rendering, corrections, vocabulary
node dev/arret-test.mjs          # start / stop / ghost microphone (15 checks)
node dev/verif-raccourci.mjs     # opening the settings from the shortcut

# variants (see the top of ext-test.mjs)
$env:TARGET="http://127.0.0.1:8765/extension-test"
$env:EXPECT="submit"             # text | submit | stop
$env:PRESET='{"replacements":{"bonjour":"SALUT"}}'
```

### Checking that the microphone is released

The extension publishes its internal state on its host element, so you can diagnose without special tools. In the browser console (F12) on a DeepSeek page:

```js
const h = document.getElementById("dsd-dictaphone-host");
h.dataset.dsdState   // "idle" | "starting" | "listening" | "stopping"
h.dataset.dsdMic     // number of microphone captures currently held, must be 0 at rest
h.dataset.dsdOpened  // total captures opened since the page loaded
```

If `dsdMic` does not return to `0` after a stop, that is a bug: please report it.

---

## 7. Files

```
dictaphone/
├── README.md                            This file
├── install.bat                          Installation (once)
├── demarrage-auto.bat                   Enable start at Windows login
├── demarrer-serveur-silencieux.vbs      Windowless launch (called at login)
├── start.bat                            Starts the server with its console
├── config.json                          Settings, vocabulary, commands, replacements
├── requirements.txt
├── logs/
│   └── serveur.log                      Silent-server log
├── tests/
│   ├── tester.bat                       Checks that the server responds
│   ├── selftest.py                      GPU / VAD / transcription test
│   ├── streamtest.py                    Real-time stream (WebSocket) test
│   ├── test-fr.wav                      French audio sample for tests
│   ├── test-commande-envoi.wav          Sentence + "Valider" (command test)
│   └── test-commande-stop.wav           Sentence + "Arrête la dictée"
├── outils/
│   ├── demarrage-auto.ps1               Enables / disables auto-start
│   ├── ouvrir-reglages.vbs              Desktop shortcut → extension settings
│   ├── dictaphone.ico                   Shortcut icon
│   ├── test-commandes.py                Voice-command test, no microphone
│   └── assembler-wav.py                 Builds the test WAVs (sentence + pause)
├── server/
│   ├── app.py                           HTTP + WebSocket server
│   ├── stt.py                           Whisper / CUDA / VAD loading
│   ├── commands.py                      Voice commands (normalisation, detection)
│   ├── cleanup.py                       Punctuation, capitals, replacements, French typography
│   ├── webui.html                       Microphone test page
│   ├── testpage.html                    Extension diagnostic page
│   ├── reglages.html                    Entry point for settings from the desktop
│   └── worklet.js
├── extension/                           ← load this in chrome://extensions
│   ├── manifest.json
│   ├── background.js                    WebSocket connection + opening the settings
│   ├── content.js                       Microphone button, gear, writing, commands
│   ├── popup.html/.js                   Quick options (toolbar icon)
│   ├── options.html/.js                 Full settings
│   ├── pcm-worklet.js                   16 kHz audio capture in 128 ms blocks
│   └── icons/
└── dev/                                 Automated validation tools
    ├── arret-test.mjs                   Start / stop / ghost microphone
    ├── cdp-test.mjs
    ├── ext-test.mjs
    ├── popup-test.mjs
    └── verif-raccourci.mjs
```

---

## 8. Privacy and performance

- **No data leaves your PC.** The server listens only on `127.0.0.1` and the model runs locally.
- Audio is sent as raw 16 kHz PCM to the local server over WebSocket (about 256 kbit/s), never to a third-party service.
- Text is split **automatically at pauses** (about 0.7 s of silence): you see sentences appear as you go, and perceived latency stays under a second.
- The model stays loaded in VRAM between dictations, so there is no wait on the second use.

---

## 9. Under the hood

- **`faster-whisper`** (CTranslate2): same quality as OpenAI's Whisper, 4 to 8× faster, `float16` on CUDA.
- **Silero VAD** (bundled): detects speech and silence to cut without chopping words.
- **Sliding `initial_prompt`**: the text already written is given to the model as context, which keeps punctuation and vocabulary consistent from one sentence to the next.
- **Local post-processing** (`cleanup.py`): removes "euh" fillers, restores capitals, fixes spaces before punctuation, applies your custom dictionary. No network call.
- **Browser insertion**: the DeepSeek Harness composer is a **Lexical** (`contenteditable`) editor; text is inserted with `execCommand('insertText')`, which Lexical listens to natively, with a fallback to plain `textarea` / `input`.

---

## 10. Server API

Useful if you want to plug something else into it.

| Route | Description |
|---|---|
| `GET /health` | engine status (model, device, VRAM, latency) |
| `GET /config` | current configuration |
| `POST /model?name=medium` | switches model live |
| `POST /transcribe` | body = PCM16 LE mono 16 kHz → `{"text": "..."}` |
| `WS /ws` | binary = PCM, text = JSON (`start`, `stop`, `reset`) |

Example:

```bash
curl -X POST --data-binary @phrase.pcm "http://127.0.0.1:8765/transcribe?language=fr"
```

---

## Appendix: setting the project up on another machine

These files are deliberately **absent from the repository** (they are specific to each machine):

| File | Why | What to do |
|---|---|---|
| `.venv/` | Python environment (2 GB) | run `install.bat` |
| `native/key.pem` | private signing key of the extension (**secret**) | only needed to package a `.crx`; Chrome can also load the extension unpacked |
| `native/com.dictaphone.launcher.json` | contains an absolute path | copy `native/com.dictaphone.launcher.example.json`, put the real path of `host.bat` and the extension ID shown at `chrome://extensions` |
| `tests/*.wav` | test recordings | record your own files (see `outils/assembler-wav.py`) |
