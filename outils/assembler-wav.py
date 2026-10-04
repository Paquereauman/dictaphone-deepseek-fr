"""
Assemble des WAV (16 kHz mono 16 bits) en inserant des silences.

Sert a fabriquer les fichiers de test des commandes vocales : une phrase,
une pause, puis le mot de commande.

    .venv\\Scripts\\python.exe outils\\assembler-wav.py tests\\sortie.wav 1.4 a.wav b.wav
"""

from __future__ import annotations

import sys
import wave
from pathlib import Path

import numpy as np

SR = 16000


def read(path: str) -> np.ndarray:
    with wave.open(path, "rb") as w:
        assert w.getframerate() == SR, f"{path}: {w.getframerate()} Hz au lieu de {SR}"
        assert w.getsampwidth() == 2, f"{path}: pas du 16 bits"
        data = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    return data.astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(SR * seconds), dtype=np.float32)


def write(path: str, parts: list[np.ndarray]) -> float:
    audio = np.concatenate(parts)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.clip(audio, -32768, 32767).astype("<i2").tobytes())
    return audio.size / SR


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    out = sys.argv[1]
    pause = float(sys.argv[2])
    sources = sys.argv[3:]
    parts: list[np.ndarray] = []
    for i, src in enumerate(sources):
        if i:
            parts.append(silence(pause))
        parts.append(read(src))
    duration = write(out, parts)
    print(f"{Path(out).name} : {duration:.2f} s ({len(sources)} segments, pause {pause} s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
