"""
Auto-test du moteur de dictee : GPU, VAD, transcription, latence.

    .venv\\Scripts\\python.exe tests\\selftest.py                        (modele small)
    .venv\\Scripts\\python.exe tests\\selftest.py medium tests\\test-fr.wav

Si un fichier WAV est fourni, il est transcrit et le resultat affiche.
"""

from __future__ import annotations

import json
import sys
import time
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # racine du projet (ce script vit dans tests/)
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from server.cleanup import clean_text  # noqa: E402
from server.stt import SAMPLE_RATE, SttEngine, speech_segments  # noqa: E402


def cleanup_options() -> dict:
    """Reprend la section `cleanup` de config.json (comme le fait le serveur)."""
    defaults = {"enabled": True, "capitalize": True, "remove_fillers": True, "replacements": {}}
    try:
        cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
        defaults.update(cfg.get("cleanup", {}))
    except Exception as exc:
        print(f"  [!] config.json illisible ({exc}), nettoyage par defaut")
    return defaults


def load_wav(path: str) -> np.ndarray:
    with wave.open(path, "rb") as w:
        n_ch, width, rate, frames = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(frames)
    if width != 2:
        raise SystemExit(f"WAV non supporte (largeur {width * 8} bits)")
    audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if n_ch > 1:
        audio = audio.reshape(-1, n_ch).mean(axis=1)
    if rate != SAMPLE_RATE:
        idx = np.linspace(0, audio.size - 1, int(audio.size * SAMPLE_RATE / rate))
        audio = np.interp(idx, np.arange(audio.size), audio).astype(np.float32)
    return np.ascontiguousarray(audio)


def main() -> int:
    model = sys.argv[1] if len(sys.argv) > 1 else "small"
    wav = sys.argv[2] if len(sys.argv) > 2 else None

    print("=" * 66)
    print(f"  AUTO-TEST — modele '{model}'")
    print("=" * 66)

    eng = SttEngine(model)
    t0 = time.perf_counter()
    info = eng.ensure(model, warmup=True)
    print(f"  device        : {info.device}")
    print(f"  compute_type  : {info.compute_type}")
    print(f"  GPU           : {info.gpu_name} ({info.vram_total_mb} Mo)")
    print(f"  chargement    : {info.load_seconds} s (total {time.perf_counter() - t0:.1f} s)")
    if info.device != "cuda":
        print("  [!] ATTENTION : le GPU n'a pas ete utilise, tout tourne sur le CPU.")

    # --- VAD sur signal synthetique ------------------------------------- #
    t = np.arange(int(SAMPLE_RATE * 3)) / SAMPLE_RATE
    tone = (0.12 * np.sin(2 * np.pi * 180 * t)).astype(np.float32)
    silence = np.zeros(SAMPLE_RATE, dtype=np.float32)
    probe = np.concatenate([silence, tone, silence])
    segs = speech_segments(probe, 300)
    print(f"  VAD           : {len(segs)} zone(s) parlee(s) detectee(s) sur un signal de test")

    # --- Transcription d'un vrai fichier -------------------------------- #
    if wav:
        audio = load_wav(wav)
        dur = audio.size / SAMPLE_RATE
        print("-" * 66)
        print(f"  Fichier       : {wav}  ({dur:.2f} s)")
        t1 = time.perf_counter()
        raw = eng.transcribe(audio, beam_size=5, language="fr", vad_filter=True)
        dt = time.perf_counter() - t1
        final = clean_text(raw, cleanup_options())
        print(f"  Transcrit en  : {dt * 1000:.0f} ms  (x{dur / max(dt, 1e-6):.1f} temps reel)")
        print(f"  BRUT          : {raw}")
        print(f"  NETTOYE       : {final}")
    else:
        print("-" * 66)
        print("  (aucun WAV fourni : test de transcription ignore)")

    print("=" * 66)
    return 0 if info.device == "cuda" else 2


if __name__ == "__main__":
    raise SystemExit(main())
