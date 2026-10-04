"""
Chargement et execution de faster-whisper, optimise pour une RTX 4050 (6 Go VRAM).

Points cles :
  * les DLL CUDA installees par pip (nvidia-cublas-cu12 / nvidia-cudnn-cu12)
    doivent etre visibles avant l'import de ctranslate2, sinon le GPU est
    silencieusement ignore et tout retombe sur le CPU (10x plus lent).
  * le modele est charge paresseusement et garde en memoire : le premier appel
    paie ~2-4 s de chargement, les suivants sont immediats.
  * bascule automatique GPU -> CPU si CUDA n'est pas utilisable.
"""

from __future__ import annotations

import glob
import logging
import os
import re
import site
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np

log = logging.getLogger("dictaphone.stt")

SAMPLE_RATE = 16_000


# --------------------------------------------------------------------------- #
#  CUDA / DLL
# --------------------------------------------------------------------------- #
def add_cuda_dll_dirs() -> list[str]:
    """Rend les DLL cuBLAS/cuDNN des wheels pip visibles au chargeur Windows."""
    if os.name != "nt":
        return []
    roots: list[str] = []
    try:
        roots.extend(site.getsitepackages())
    except Exception:  # pragma: no cover
        pass
    try:
        roots.append(site.getusersitepackages())
    except Exception:  # pragma: no cover
        pass
    try:
        import sysconfig

        roots.append(sysconfig.get_paths().get("purelib", ""))
    except Exception:  # pragma: no cover
        pass

    added: list[str] = []
    for root in roots:
        if not root:
            continue
        nvidia_root = os.path.join(root, "nvidia")
        if not os.path.isdir(nvidia_root):
            continue
        for dll_dir in glob.glob(os.path.join(nvidia_root, "*", "bin")):
            try:
                os.add_dll_directory(dll_dir)
            except Exception:
                pass
            os.environ["PATH"] = dll_dir + os.pathsep + os.environ.get("PATH", "")
            added.append(dll_dir)
    return added


_CUDA_DIRS = add_cuda_dll_dirs()

from faster_whisper import WhisperModel  # noqa: E402  (doit venir apres les DLL)

try:  # Le VAD Silero est embarque dans le wheel faster-whisper (aucun telechargement).
    from faster_whisper.vad import VadOptions, get_speech_timestamps
except Exception:  # pragma: no cover
    VadOptions = None  # type: ignore[assignment]
    get_speech_timestamps = None  # type: ignore[assignment]


# --------------------------------------------------------------------------- #
#  VAD
# --------------------------------------------------------------------------- #
def is_prompt_echo(text: str, prompt: str | None) -> bool:
    """Vrai si la sortie n'est qu'un echo du prompt (hallucination classique).

    Whisper, quand on lui donne un `initial_prompt`, peut le recracher tel quel
    sur un passage sans parole. On rejette ce cas.
    """
    if not prompt or not text:
        return False
    norm = lambda s: re.sub(r"\W+", "", s).lower()  # noqa: E731
    t, p = norm(text), norm(prompt)
    if not t:
        return True
    # Echo pur ou quasi : la sortie represente une grande partie du prompt.
    # Le seuil evite de rejeter une phrase courte qui reprend un mot du
    # vocabulaire (ex. « API »).
    return t in p and len(t) >= max(16, int(0.5 * len(p)))


def speech_segments(audio: np.ndarray, min_silence_ms: int = 300, threshold: float = 0.5):
    """Retourne [(debut_echantillon, fin_echantillon), ...] des zones parlees.

    Utilise le VAD Silero de faster-whisper ; se rabat sur un VAD d'energie
    (RMS) si onnxruntime n'est pas disponible.
    """
    if audio.size == 0:
        return []
    if get_speech_timestamps is not None and VadOptions is not None:
        try:
            opts = VadOptions(
                threshold=threshold,
                min_speech_duration_ms=120,
                min_silence_duration_ms=min_silence_ms,
                speech_pad_ms=80,
            )
            spans = get_speech_timestamps(audio, opts)
            return [(int(s["start"]), int(s["end"])) for s in spans]
        except Exception as exc:  # pragma: no cover
            log.debug("VAD Silero indisponible (%s) -> VAD energie", exc)
    return _energy_segments(audio, min_silence_ms)


def _energy_segments(audio: np.ndarray, min_silence_ms: int):
    """VAD de secours : seuil RMS adaptatif, fenetres de 20 ms."""
    win = 320  # 20 ms @ 16 kHz
    n = audio.size // win
    if n == 0:
        return []
    frames = audio[: n * win].reshape(n, win)
    rms = np.sqrt(np.mean(frames.astype(np.float32) ** 2, axis=1) + 1e-12)
    noise = float(np.percentile(rms, 20))
    thr = max(noise * 3.5, 0.006)
    voiced = rms > thr
    spans: list[tuple[int, int]] = []
    gap = 0
    max_gap = max(1, int(min_silence_ms / 20))
    start = None
    for i, v in enumerate(voiced):
        if v:
            if start is None:
                start = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= max_gap:
                spans.append((start * win, (i - gap + 1) * win))
                start = None
                gap = 0
    if start is not None:
        spans.append((start * win, n * win))
    return [s for s in spans if s[1] - s[0] > 1600]


# --------------------------------------------------------------------------- #
#  Moteur
# --------------------------------------------------------------------------- #
@dataclass
class EngineInfo:
    model: str = "-"
    device: str = "-"
    compute_type: str = "-"
    loaded: bool = False
    load_seconds: float = 0.0
    gpu_name: str = "-"
    vram_total_mb: int = 0
    last_infer_ms: float = 0.0
    last_audio_s: float = 0.0
    total_calls: int = 0
    extra: dict[str, Any] = field(default_factory=dict)


def _gpu_info() -> tuple[str, int]:
    try:
        import subprocess

        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if out.returncode == 0 and out.stdout.strip():
            name, mem = out.stdout.strip().splitlines()[0].split(",")
            return name.strip(), int(mem.strip())
    except Exception:
        pass
    return "-", 0


class SttEngine:
    """Enveloppe thread-safe autour de WhisperModel."""

    #: du plus leger au plus lourd
    KNOWN_MODELS = (
        "tiny",
        "base",
        "small",
        "medium",
        "large-v3",
        "large-v3-turbo",
        "distil-large-v3",
    )

    def __init__(
        self,
        model: str = "small",
        device: str = "auto",
        compute_type: str = "auto",
        download_root: str | None = None,
    ) -> None:
        self._lock = threading.RLock()
        self._model: WhisperModel | None = None
        self._key: tuple[str, str, str] | None = None
        self.info = EngineInfo(model=model)
        self.info.gpu_name, self.info.vram_total_mb = _gpu_info()
        self._desired = (model, device, compute_type)
        self._download_root = download_root

    # -- chargement -------------------------------------------------------- #
    def configure(self, model: str | None = None, device: str | None = None,
                  compute_type: str | None = None) -> None:
        """Change la cible de chargement (applique au prochain acces)."""
        cur = self._desired
        self._desired = (model or cur[0], device or cur[1], compute_type or cur[2])

    def _resolve(self, device: str, compute_type: str) -> tuple[str, str]:
        if device == "auto":
            device = "cuda"
        if compute_type == "auto":
            compute_type = "float16" if device == "cuda" else "int8"
        return device, compute_type

    def ensure(self, model: str | None = None, device: str | None = None,
               compute_type: str | None = None, warmup: bool = True) -> EngineInfo:
        """Charge (ou recharge) le modele demande. Renvoie l'etat courant."""
        with self._lock:
            model = model or self._desired[0]
            device = device or self._desired[1]
            compute_type = compute_type or self._desired[2]
            device, compute_type = self._resolve(device, compute_type)
            key = (model, device, compute_type)

            if self._model is not None and self._key == key:
                return self.info

            attempts: list[tuple[str, str]] = [(device, compute_type)]
            if device == "cuda":
                # 1) GPU en int8_float16 (2x moins de VRAM)  2) CPU int8
                attempts += [("cuda", "int8_float16"), ("cpu", "int8")]

            last_exc: Exception | None = None
            for dev, ctype in attempts:
                try:
                    log.info("Chargement du modele '%s' (%s / %s)...", model, dev, ctype)
                    t0 = time.perf_counter()
                    self._model = WhisperModel(
                        model,
                        device=dev,
                        compute_type=ctype,
                        download_root=self._download_root,
                        num_workers=1,
                        cpu_threads=max(4, (os.cpu_count() or 4) // 2),
                    )
                    elapsed = time.perf_counter() - t0
                    self._key = (model, dev, ctype)
                    self._desired = (model, dev, ctype)
                    self.info.model = model
                    self.info.device = dev
                    self.info.compute_type = ctype
                    self.info.loaded = True
                    self.info.load_seconds = round(elapsed, 2)
                    log.info("Modele pret en %.1f s (%s/%s)", elapsed, dev, ctype)
                    if warmup:
                        self._warmup()
                    return self.info
                except Exception as exc:  # pragma: no cover
                    last_exc = exc
                    log.warning("Echec chargement %s/%s : %s", dev, ctype, exc)

            self.info.loaded = False
            raise RuntimeError(f"Impossible de charger le modele {model}: {last_exc}")

    def _warmup(self) -> None:
        """Force l'allocation des buffers CUDA (evite le lag au 1er mot)."""
        try:
            silence = np.zeros(SAMPLE_RATE // 2, dtype=np.float32)
            assert self._model is not None
            list(self._model.transcribe(silence, language="fr", beam_size=1, vad_filter=False)[0])
            log.info("Warmup OK")
        except Exception as exc:  # pragma: no cover
            log.debug("Warmup ignore : %s", exc)

    # -- inference --------------------------------------------------------- #
    def _run(self, audio: np.ndarray, *, beam_size: int, language: str | None,
             vad_filter: bool, initial_prompt: str | None,
             without_timestamps: bool) -> str:
        assert self._model is not None
        kwargs: dict[str, Any] = dict(
            language=language,
            beam_size=beam_size,
            vad_filter=vad_filter,
            without_timestamps=without_timestamps,
            condition_on_previous_text=False,
            temperature=0.0 if beam_size > 1 else [0.0, 0.2],
        )
        if vad_filter:
            kwargs["vad_parameters"] = dict(min_silence_duration_ms=400)
        if initial_prompt:
            kwargs["initial_prompt"] = initial_prompt

        segments, _info = self._model.transcribe(audio, **kwargs)
        return " ".join(seg.text.strip() for seg in segments).strip()

    def transcribe(
        self,
        audio: np.ndarray,
        *,
        beam_size: int = 5,
        language: str | None = "fr",
        vad_filter: bool = True,
        initial_prompt: str | None = None,
        without_timestamps: bool = True,
    ) -> str:
        """Transcrit un tableau float32 mono 16 kHz."""
        if audio.dtype != np.float32:
            audio = audio.astype(np.float32)
        audio = np.ascontiguousarray(audio)
        if audio.size < 1600:  # < 100 ms : rien a faire
            return ""
        if not np.isfinite(audio).all():
            audio = np.nan_to_num(audio)

        self.ensure()
        t0 = time.perf_counter()
        with self._lock:
            text = self._run(
                audio,
                beam_size=beam_size,
                language=language or None,
                vad_filter=vad_filter,
                initial_prompt=initial_prompt,
                without_timestamps=without_timestamps,
            )
        dur = time.perf_counter() - t0
        self.info.last_infer_ms = round(dur * 1000, 1)
        self.info.last_audio_s = round(audio.size / SAMPLE_RATE, 2)
        self.info.total_calls += 1
        return text
