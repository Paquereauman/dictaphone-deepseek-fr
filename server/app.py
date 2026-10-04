"""
Serveur de dictee locale : HTTP + WebSocket, Whisper GPU, 100 % hors ligne.

    python -m server.app            (depuis le dossier dictaphone/)

API :
    GET  /                    page de test (micro dans le navigateur)
    GET  /health              etat du moteur (modele, GPU, VRAM, latence)
    GET  /config              configuration courante
    POST /model?name=medium   change de modele a chaud
    POST /transcribe          corps = PCM16 LE mono 16 kHz -> {"text": ...}
    WS   /ws                  dictee temps reel (binaire = PCM, texte = JSON)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

# pythonw.exe (lancement sans console) met sys.stdout / sys.stderr a None.
# Certaines bibliotheques ecrivent sur la sortie standard au moment de leur
# import : sans ce garde-fou, le serveur lance en mode silencieux meurt
# immediatement (code de sortie 1, aucun journal).
if sys.stdout is None or sys.stderr is None:
    _devnull = open(os.devnull, "w", encoding="utf-8")
    sys.stdout = sys.stdout or _devnull
    sys.stderr = sys.stderr or _devnull

import numpy as np  # noqa: E402
import uvicorn
from fastapi import FastAPI, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import commands as voice  # noqa: E402
from server.cleanup import clean_text  # noqa: E402
from server.stt import SAMPLE_RATE, SttEngine, is_prompt_echo, speech_segments  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.json"
WEBUI_PATH = Path(__file__).resolve().parent / "webui.html"

log = logging.getLogger("dictaphone")

#: Compteurs de diagnostic exposes par /health (utiles pour verifier que
#: l'audio arrive vraiment depuis l'extension).
STATS: dict[str, int] = {"frames": 0, "audio_bytes": 0, "finalized": 0}

DEFAULTS: dict[str, Any] = {
    "host": "127.0.0.1",
    "port": 8765,
    "model": "small",
    "language": "fr",
    "device": "auto",
    "compute_type": "auto",
    "beam_size": 5,
    "partial_beam_size": 1,
    "silence_ms": 700,
    "min_speech_ms": 250,
    "max_chunk_s": 18.0,
    "partial_interval_ms": 800,
    "preload": True,
    "warmup": True,
    "vocabulary": "",
    "voice_commands": {},
    "cleanup": {"enabled": True, "capitalize": True, "remove_fillers": True,
                "french_typography": False, "replacements": {}},
}


def load_config() -> dict[str, Any]:
    cfg = json.loads(json.dumps(DEFAULTS))
    if CONFIG_PATH.exists():
        try:
            user = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            for k, v in user.items():
                if k == "cleanup" and isinstance(v, dict):
                    cfg["cleanup"].update(v)
                else:
                    cfg[k] = v
        except Exception as exc:
            log.warning("config.json illisible (%s) -> valeurs par defaut", exc)
    return cfg


CONFIG = load_config()
ENGINE = SttEngine(
    model=CONFIG["model"],
    device=CONFIG["device"],
    compute_type=CONFIG["compute_type"],
)


# --------------------------------------------------------------------------- #
#  Session de dictee temps reel
# --------------------------------------------------------------------------- #
class StreamSession:
    """Accumule le PCM, decoupe sur les silences, pousse partiels et finals."""

    def __init__(self, engine: SttEngine, cfg: dict[str, Any],
                 send: Callable[[dict], Awaitable[None]]) -> None:
        self.engine = engine
        self.cfg = cfg
        self.send = send
        self.language: str = cfg.get("language", "fr")
        self.model: str | None = None
        self.vocabulary: str = str(cfg.get("vocabulary") or "").strip()
        # Surcharges par session (reglages de l'extension) : elles evitent de
        # redemarrer le serveur quand on ajoute une correction ou un mot.
        self.cleanup_opts: dict[str, Any] = dict(cfg.get("cleanup") or {})
        self.replacements: dict[str, str] = dict(self.cleanup_opts.get("replacements") or {})
        self.commands, self.whole_segment = voice.resolve(cfg.get("voice_commands") or {})
        self._pending: list[np.ndarray] = []
        self._buf = np.zeros(0, dtype=np.float32)
        self._committed: list[str] = []
        self._last_partial_at = 0.0
        self._closed = False
        self._busy = False
        self._last_voice_at = time.time()

    # -- entree ------------------------------------------------------------ #
    def feed(self, pcm_bytes: bytes) -> None:
        if not pcm_bytes:
            return
        pcm = np.frombuffer(pcm_bytes, dtype="<i2")
        if pcm.size == 0:
            return
        STATS["frames"] += 1
        STATS["audio_bytes"] += len(pcm_bytes)
        self._pending.append(pcm.astype(np.float32) / 32768.0)

    def configure(self, msg: dict[str, Any]) -> None:
        if msg.get("language"):
            self.language = str(msg["language"])
        if msg.get("model"):
            self.model = str(msg["model"])
        if msg.get("vocabulary") is not None:
            # Le vocabulaire de l'extension s'ajoute a celui de config.json :
            # ajouter un mot dans l'interface ne fait pas perdre les autres.
            extra = str(msg["vocabulary"]).strip()
            base = str(self.cfg.get("vocabulary") or "").strip()
            self.vocabulary = ", ".join(p for p in (base, extra) if p)
        if isinstance(msg.get("replacements"), dict):
            merged = dict(self.cleanup_opts.get("replacements") or {})
            merged.update({str(k): str(v) for k, v in msg["replacements"].items()})
            self.replacements = merged
        if isinstance(msg.get("cleanup"), dict):
            self.cleanup_opts.update(msg["cleanup"])
        if isinstance(msg.get("voice_commands"), dict) or "whole_segment" in msg:
            merged = dict(self.cfg.get("voice_commands") or {})
            merged.update(msg.get("voice_commands") or {})
            if "whole_segment" in msg:
                merged["whole_segment"] = msg["whole_segment"]
            self.commands, self.whole_segment = voice.resolve(merged)
        log.debug(
            "session: langue=%s modele=%s vocabulaire=%d mots remplacements=%d commandes=%d",
            self.language, self.model or "(defaut)", len(self.vocabulary.split()),
            len(self.replacements), sum(len(v) for v in self.commands.values()),
        )

    def reset(self) -> None:
        self._pending.clear()
        self._buf = np.zeros(0, dtype=np.float32)
        self._committed.clear()

    def close(self) -> None:
        self._closed = True

    def _drain(self) -> None:
        if self._pending:
            self._buf = np.concatenate([self._buf, *self._pending])
            self._pending.clear()

    @property
    def _prompt(self) -> str | None:
        """Vocabulaire metier + fin du texte deja dicte.

        Whisper est fortement influence par ce texte : y placer les noms propres
        (« DeepSeek », « Harness »...) corrige la plupart des erreurs de
        reconnaissance sans aucun appel reseau.
        """
        parts = []
        if self.vocabulary:
            parts.append(self.vocabulary)
        tail = " ".join(self._committed)[-200:]
        if tail:
            parts.append(tail)
        return " ".join(parts) or None

    # -- boucle ------------------------------------------------------------ #
    async def run(self) -> None:
        interval = max(0.08, float(self.cfg.get("partial_interval_ms", 800)) / 1000.0 / 4)
        while not self._closed:
            await asyncio.sleep(interval)
            try:
                await self.tick()
            except Exception as exc:  # pragma: no cover
                log.exception("tick: %s", exc)

    async def tick(self) -> None:
        if self._busy:
            return
        self._drain()
        n = int(self._buf.size)
        if n < SAMPLE_RATE // 4:  # < 250 ms
            return

        silence_samples = int(SAMPLE_RATE * float(self.cfg["silence_ms"]) / 1000.0)
        min_speech = int(SAMPLE_RATE * float(self.cfg["min_speech_ms"]) / 1000.0)
        max_chunk = int(SAMPLE_RATE * float(self.cfg["max_chunk_s"]))

        # Analyse du VAD sur la fenetre recente uniquement (cout constant).
        w0 = max(0, n - int(SAMPLE_RATE * 3.0))
        window = self._buf[w0:]
        segs = await asyncio.to_thread(
            speech_segments, window, int(self.cfg["silence_ms"])
        )
        # Le tampon a pu etre consomme pendant le calcul du VAD (flush() sur
        # `stop`) : tout ce qui suit porterait sur des donnees perimees.
        if self._buf.size < n:
            return
        segs = [(b, e) for b, e in segs if e - b >= 800]  # ignore < 50 ms

        if segs:
            last_end = w0 + segs[-1][1]
            speech_len = sum(e - b for b, e in segs)
        else:
            last_end = 0
            speech_len = 0

        trailing = n - last_end if segs else n
        has_speech = speech_len >= min_speech

        now = time.time()

        # 1) Fin de parole -> on fige le morceau.
        #    Le tampon est consomme AVANT tout `await` : sinon la boucle et
        #    flush() (sur `stop`) pourraient finaliser le meme audio deux fois.
        forced = n >= max_chunk
        if has_speech and (trailing >= silence_samples or forced):
            cut = n if forced else last_end
            audio = self._buf[:cut]
            self._buf = self._buf[cut:]
            self._last_partial_at = 0.0
            await self._finalize(audio)
            return

        # 2) Silence total -> on jette le bruit de fond.
        if not has_speech and trailing >= silence_samples and n > SAMPLE_RATE:
            self._buf = np.zeros(0, dtype=np.float32)
            self._last_partial_at = 0.0
            return

        # 3) Partiel pour l'affichage live.
        if has_speech:
            if (now - self._last_partial_at) * 1000.0 >= float(self.cfg["partial_interval_ms"]):
                self._last_partial_at = now
                await self._partial(self._buf[:last_end])

    async def _partial(self, audio: np.ndarray) -> None:
        if audio.size < SAMPLE_RATE // 3:
            return
        self._busy = True
        try:
            text = await asyncio.to_thread(
                self.engine.transcribe,
                audio,
                beam_size=int(self.cfg["partial_beam_size"]),
                language=self.language,
                vad_filter=False,
                initial_prompt=self._prompt,
            )
            if text and not is_prompt_echo(text, self._prompt):
                await self.send({"type": "partial", "text": text})
        except Exception as exc:
            log.warning("partiel: %s", exc)
        finally:
            self._busy = False

    async def _finalize(self, audio: np.ndarray) -> None:
        if audio.size < SAMPLE_RATE // 5:
            return
        self._busy = True
        try:
            if self.model:
                await asyncio.to_thread(self.engine.ensure, self.model)
            raw = await asyncio.to_thread(
                self.engine.transcribe,
                audio,
                beam_size=int(self.cfg["beam_size"]),
                language=self.language,
                vad_filter=True,
                initial_prompt=self._prompt,
            )
            if is_prompt_echo(raw, self._prompt):
                return

            # Commande vocale ? On l'execute et on ne l'ecrit pas dans le texte.
            name, rest = voice.match_command(raw, self.commands, self.whole_segment)
            if name:
                log.debug("commande vocale detectee : %s (%r)", name, raw.strip())
                await self.send({"type": "command", "name": name, "heard": raw.strip()})
                rest = (rest or "").strip()
                if rest:
                    text = clean_text(rest, self.cleanup_opts, self.replacements)
                    if text:
                        self._committed.append(text)
                        self._committed = self._committed[-6:]
                        STATS["finalized"] += 1
                        await self.send({"type": "final", "text": text})
                return

            text = clean_text(raw, self.cleanup_opts, self.replacements)
            if not text:
                return
            self._committed.append(text)
            self._committed = self._committed[-6:]
            STATS["finalized"] += 1
            await self.send({
                "type": "final",
                "text": text,
                "audio_s": round(audio.size / SAMPLE_RATE, 2),
                "infer_ms": self.engine.info.last_infer_ms,
            })
        except Exception as exc:
            log.exception("final: %s", exc)
            await self.send({"type": "error", "message": str(exc)})
        finally:
            self._busy = False

    async def flush(self) -> None:
        """Fin d'enregistrement : transcrit ce qui reste."""
        # Attendre la fin d'une finalisation en cours evite d'ecrire deux fois.
        waited = 0.0
        while self._busy and waited < 20.0:
            await asyncio.sleep(0.05)
            waited += 0.05
        self._drain()
        if self._buf.size >= SAMPLE_RATE // 5:
            buf = self._buf
            self._buf = np.zeros(0, dtype=np.float32)
            await self._finalize(buf)
        await self.send({"type": "done"})


# --------------------------------------------------------------------------- #
#  Application
# --------------------------------------------------------------------------- #
async def _lifespan(app: FastAPI):
    cfg = CONFIG
    log.info("=" * 68)
    log.info("  Dictaphone FR - serveur local sur http://%s:%s", cfg["host"], cfg["port"])
    log.info("=" * 68)
    if cfg.get("preload", True):
        try:
            info = await asyncio.to_thread(
                ENGINE.ensure, cfg["model"], None, None, bool(cfg.get("warmup", True))
            )
            log.info("  Modele : %s   Device : %s   Precision : %s", info.model, info.device, info.compute_type)
            if info.gpu_name != "-":
                log.info("  GPU    : %s (%s Mo)", info.gpu_name, info.vram_total_mb)
            log.info("  Pret. Ouvre l'extension Chrome et clique sur le micro.")
        except Exception as exc:
            log.error("  Le modele n'a pas pu etre charge : %s", exc)
    else:
        # Demarrage a l'ouverture de session : on ne reserve PAS la VRAM tant
        # que l'utilisateur n'a pas dicte (le modele se charge a la demande).
        log.info("  Chargement paresseux : '%s' sera charge a la premiere dictee (~2 s).", cfg["model"])
        log.info("  0 Mo de VRAM utilisee tant que tu ne dictes pas.")
        log.info("  Pret. Ouvre l'extension Chrome et clique sur le micro.")
    log.info("=" * 68)
    yield
    log.info("Arret du serveur.")


app = FastAPI(title="Dictaphone FR", version="1.0.0", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def index():
    if WEBUI_PATH.exists():
        return FileResponse(WEBUI_PATH)
    return JSONResponse({"ok": True, "hint": "webui.html manquant"})


@app.get("/worklet.js")
async def worklet():
    path = Path(__file__).resolve().parent / "worklet.js"
    if path.exists():
        return FileResponse(path, media_type="application/javascript")
    return JSONResponse({"ok": False}, status_code=404)


@app.get("/extension-test")
async def extension_test():
    """Page qui simule le composer de DeepSeek, pour tester l'extension seule."""
    path = Path(__file__).resolve().parent / "testpage.html"
    if path.exists():
        return FileResponse(path)
    return JSONResponse({"ok": False, "error": "testpage.html manquant"}, status_code=404)


@app.get("/reglages")
async def reglages():
    """Point d'entree des reglages : la page demande a l'extension de s'ouvrir.

    Chrome interdit d'ouvrir une URL chrome-extension:// depuis un raccourci
    Windows, d'ou ce detour par une page locale.
    """
    path = Path(__file__).resolve().parent / "reglages.html"
    if path.exists():
        return FileResponse(path)
    return JSONResponse({"ok": False, "error": "reglages.html manquant"}, status_code=404)


@app.get("/health")
async def health():
    info = ENGINE.info
    return {
        # `ok` = le serveur repond. Le modele peut n'etre pas encore charge
        # (demarrage automatique en chargement paresseux).
        "ok": True,
        "model_loaded": info.loaded,
        "model": info.model,
        "device": info.device,
        "compute_type": info.compute_type,
        "load_seconds": info.load_seconds,
        "gpu": info.gpu_name,
        "vram_total_mb": info.vram_total_mb,
        "last_infer_ms": info.last_infer_ms,
        "last_audio_s": info.last_audio_s,
        "total_calls": info.total_calls,
        "language": CONFIG["language"],
        "stats": dict(STATS),
    }


@app.get("/config")
async def get_config():
    return CONFIG


@app.post("/model")
async def set_model(name: str = Query(..., description="tiny|base|small|medium|large-v3-turbo")):
    if name not in SttEngine.KNOWN_MODELS:
        return JSONResponse({"ok": False, "error": f"modele inconnu: {name}"}, status_code=400)
    info = await asyncio.to_thread(ENGINE.ensure, name, None, None, True)
    CONFIG["model"] = name
    return {"ok": True, "model": info.model, "device": info.device, "compute_type": info.compute_type}


@app.post("/transcribe")
async def transcribe_once(
    request: Request,
    sample_rate: int = Query(SAMPLE_RATE),
    language: str = Query("fr"),
    beam_size: int = Query(5),
    cleanup: bool = Query(True),
):
    """Corps = PCM 16 bits signe little-endian mono. Renvoie le texte nettoye."""
    body = await request.body()
    if not body:
        return JSONResponse({"ok": False, "error": "corps vide"}, status_code=400)
    audio = np.frombuffer(body, dtype="<i2").astype(np.float32) / 32768.0
    if sample_rate != SAMPLE_RATE:  # reechantillonnage lineaire simple
        idx = np.linspace(0, audio.size - 1, int(audio.size * SAMPLE_RATE / sample_rate))
        audio = np.interp(idx, np.arange(audio.size), audio).astype(np.float32)
    text = await asyncio.to_thread(
        ENGINE.transcribe, audio, beam_size=beam_size, language=language, vad_filter=True
    )
    final = clean_text(text, CONFIG.get("cleanup")) if cleanup else text
    return {"ok": True, "text": final, "raw": text, "audio_s": round(audio.size / SAMPLE_RATE, 2)}


@app.websocket("/ws")
async def ws_stream(ws: WebSocket):
    await ws.accept()
    cfg = load_config() if CONFIG_PATH.exists() else CONFIG

    async def send(payload: dict) -> None:
        try:
            await ws.send_json(payload)
        except Exception:
            pass

    session = StreamSession(ENGINE, cfg, send)
    task = asyncio.create_task(session.run())
    info = ENGINE.info
    await send({
        "type": "ready",
        "model": info.model,
        "device": info.device,
        "compute_type": info.compute_type,
        "sample_rate": SAMPLE_RATE,
        "silence_ms": cfg["silence_ms"],
    })
    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("bytes"):
                session.feed(msg["bytes"])
            elif msg.get("text") is not None:
                try:
                    data = json.loads(msg["text"])
                except Exception:
                    continue
                kind = data.get("type")
                if kind == "start":
                    session.configure(data)
                    await send({"type": "started"})
                elif kind == "stop":
                    await session.flush()
                elif kind == "reset":
                    session.reset()
                elif kind == "ping":
                    await send({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # pragma: no cover
        log.debug("ws: %s", exc)
    finally:
        try:
            await session.flush()
        except Exception:
            pass
        session.close()
        task.cancel()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serveur de dictee vocale locale")
    parser.add_argument("--host", default=CONFIG["host"])
    parser.add_argument("--port", type=int, default=CONFIG["port"])
    parser.add_argument("--model", default=None, help="force un modele au demarrage")
    parser.add_argument("--cpu", action="store_true", help="force le CPU")
    parser.add_argument("--log", action="store_true", help="journalise dans logs/serveur.log")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    if args.model:
        CONFIG["model"] = args.model
        ENGINE.configure(model=args.model)
    if args.cpu:
        CONFIG["device"] = "cpu"
        ENGINE.configure(device="cpu", compute_type="int8")

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s  %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    if args.log:
        # Indispensable quand le serveur tourne sans console (demarrage auto).
        from logging.handlers import RotatingFileHandler

        log_dir = ROOT / "logs"
        log_dir.mkdir(exist_ok=True)
        handler = RotatingFileHandler(
            log_dir / "serveur.log", maxBytes=1_000_000, backupCount=2, encoding="utf-8"
        )
        handler.setFormatter(
            logging.Formatter("%(asctime)s  %(levelname)-7s %(name)s: %(message)s")
        )
        logging.getLogger().addHandler(handler)

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
