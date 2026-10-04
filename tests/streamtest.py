"""
Simule le client de l'extension : envoie un WAV au serveur en temps reel
(trames PCM de 128 ms, comme le micro) et affiche partiels + finals.

    .venv\\Scripts\\python.exe tests\\streamtest.py tests\\test-fr.wav
    .venv\\Scripts\\python.exe tests\\streamtest.py --fast      (envoie l'audio sans attendre le temps reel)
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
import wave
from pathlib import Path

import numpy as np
from websockets.asyncio.client import connect

SR = 16000
HERE = Path(__file__).resolve().parent
CHUNK_MS = 128


def load_wav(path: str) -> np.ndarray:
    with wave.open(path, "rb") as w:
        n_ch, width, rate, frames = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(frames)
    audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if n_ch > 1:
        audio = audio.reshape(-1, n_ch).mean(axis=1)
    if rate != SR:
        idx = np.linspace(0, audio.size - 1, int(audio.size * SR / rate))
        audio = np.interp(idx, np.arange(audio.size), audio).astype(np.float32)
    return np.ascontiguousarray(audio)


async def main() -> int:
    pace = "--fast" not in sys.argv
    args = [a for a in sys.argv[1:] if a != "--fast"]
    wav = args[0] if args else str(HERE / "test-fr.wav")
    url = args[1] if len(args) > 1 else "ws://127.0.0.1:8765/ws"

    audio = load_wav(wav)
    pcm = np.clip(audio * 32768.0, -32768, 32767).astype("<i2")
    total = pcm.size
    step = SR * CHUNK_MS // 1000

    print(f"Fichier {wav} : {audio.size / SR:.2f} s  ->  {url}")
    finals: list[str] = []
    t0 = time.perf_counter()

    async with connect(url, max_size=None) as ws:
        async def reader():
            async for raw in ws:
                msg = json.loads(raw)
                kind = msg.get("type")
                if kind == "partial":
                    print(f"  [{time.perf_counter() - t0:5.2f}s] ... {msg['text']}")
                elif kind == "final":
                    finals.append(msg["text"])
                    print(f"  [{time.perf_counter() - t0:5.2f}s] FINAL  {msg['text']}")
                elif kind == "ready":
                    print(f"  moteur pret : {msg.get('model')} / {msg.get('device')}")
                elif kind == "error":
                    print(f"  ERREUR : {msg.get('message')}")
                elif kind == "done":
                    return

        task = asyncio.create_task(reader())
        await ws.send(json.dumps({"type": "start", "language": "fr"}))
        for i in range(0, total, step):
            await ws.send(pcm[i:i + step].tobytes())
            if pace:
                await asyncio.sleep(CHUNK_MS / 1000.0)
        print(f"  [{time.perf_counter() - t0:5.2f}s] audio envoye, arret...")
        await ws.send(json.dumps({"type": "stop"}))
        try:
            await asyncio.wait_for(task, timeout=25)
        except asyncio.TimeoutError:
            task.cancel()

    print("-" * 66)
    print("TEXTE COMPLET :", " ".join(finals) if finals else "(rien)")
    print(f"Duree totale : {time.perf_counter() - t0:.2f} s pour {audio.size / SR:.2f} s d'audio")
    return 0 if finals else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
