"""
Local speech service — faster-whisper STT + Piper TTS.
NEVER calls cloud STT/TTS. Bound to localhost:8001.
"""

from __future__ import annotations

import importlib.util
import io
import logging
import os
import tempfile
import traceback
import wave
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("speech-service")

APP_DIR = Path(__file__).resolve().parent
VOICES_DIR = APP_DIR / "voices"
# Bundled voice (download via scripts/download_voice.py — not committed)
DEFAULT_VOICE = os.environ.get("PIPER_VOICE", "en_US-lessac-medium")
VOICE_ONNX = VOICES_DIR / f"{DEFAULT_VOICE}.onnx"
VOICE_JSON = VOICES_DIR / f"{DEFAULT_VOICE}.onnx.json"

# Whisper avg_logprob: closer to 0 is better; very low → reject
AVG_LOGPROB_FAIL = float(os.environ.get("AVG_LOGPROB_FAIL", "-1.2"))

app = FastAPI(title="Logisoft HireOS — Speech Service", version="1.0.0")

_whisper = None
_whisper_model_name: str = "medium"
_device: Literal["cuda", "cpu"] = "cpu"
_piper_voice = None


def _register_nvidia_dlls() -> None:
    """Windows: expose pip nvidia-* bin dirs so ctranslate2/CUDA can load DLLs.
    No-op in CPU Docker images where nvidia-* packages are not installed.
    """
    bins: list[str] = []
    for pkg in ("nvidia.cublas", "nvidia.cudnn", "nvidia.cuda_nvrtc"):
        try:
            spec = importlib.util.find_spec(pkg)
        except ModuleNotFoundError:
            continue
        if spec and spec.submodule_search_locations:
            bin_dir = os.path.join(
                list(spec.submodule_search_locations)[0], "bin"
            )
            if os.path.isdir(bin_dir):
                bins.append(bin_dir)
                if hasattr(os, "add_dll_directory"):
                    os.add_dll_directory(bin_dir)
                log.info("Registered NVIDIA DLL directory: %s", bin_dir)
    if bins:
        # PATH is still required on some Windows/ctranslate2 builds
        os.environ["PATH"] = os.pathsep.join(bins) + os.pathsep + os.environ.get(
            "PATH", ""
        )


def _init_whisper() -> None:
    global _whisper, _whisper_model_name, _device
    _register_nvidia_dlls()
    from faster_whisper import WhisperModel

    try:
        import ctranslate2

        cuda_ok = ctranslate2.get_cuda_device_count() > 0
    except Exception:
        cuda_ok = False

    if cuda_ok:
        _device = "cuda"
        _whisper_model_name = os.environ.get("WHISPER_MODEL", "medium")
        compute_type = os.environ.get("WHISPER_COMPUTE", "int8_float16")
        log.info(
            "Loading Whisper model=%s device=cuda compute_type=%s",
            _whisper_model_name,
            compute_type,
        )
        _whisper = WhisperModel(
            _whisper_model_name, device="cuda", compute_type=compute_type
        )
    else:
        _device = "cpu"
        _whisper_model_name = os.environ.get("WHISPER_MODEL_CPU", "small")
        compute_type = os.environ.get("WHISPER_COMPUTE_CPU", "int8")
        log.warning(
            "CUDA unavailable — falling back to Whisper model=%s device=cpu compute_type=%s",
            _whisper_model_name,
            compute_type,
        )
        _whisper = WhisperModel(
            _whisper_model_name, device="cpu", compute_type=compute_type
        )


def _init_piper() -> None:
    global _piper_voice
    if not VOICE_ONNX.exists():
        log.warning(
            "Piper voice not found at %s — run scripts/download_voice.py",
            VOICE_ONNX,
        )
        _piper_voice = None
        return
    from piper import PiperVoice

    log.info("Loading Piper voice %s", VOICE_ONNX.name)
    _piper_voice = PiperVoice.load(str(VOICE_ONNX), config_path=str(VOICE_JSON) if VOICE_JSON.exists() else None)


@app.on_event("startup")
def startup() -> None:
    _init_whisper()
    _init_piper()
    log.info(
        "Speech service ready device=%s whisper=%s voice=%s",
        _device,
        _whisper_model_name,
        DEFAULT_VOICE if _piper_voice else "MISSING",
    )


class SynthesizeBody(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


@app.get("/health")
def health():
    return {
        "ok": _whisper is not None,
        "device": _device,
        "whisperModel": _whisper_model_name,
        "voice": DEFAULT_VOICE if _piper_voice is not None else None,
        "piperReady": _piper_voice is not None,
    }


def _audio_to_wav_path(data: bytes, suffix: str) -> str:
    """Write upload to a temp file; convert to wav via ffmpeg-python/pydub if needed."""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(data)
    tmp.close()
    if suffix.lower() in {".wav", ".wave"}:
        return tmp.name

    # Decode webm/opus/etc. with soundfile + av, or ffmpeg
    out = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    out.close()
    try:
        import subprocess

        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            tmp.name,
            "-ac",
            "1",
            "-ar",
            "16000",
            out.name,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            # Fallback: try reading with av/PyAV if installed
            try:
                import av

                container = av.open(tmp.name)
                stream = container.streams.audio[0]
                frames = []
                sample_rate = stream.rate or 16000
                for frame in container.decode(audio=0):
                    arr = frame.to_ndarray()
                    if arr.ndim > 1:
                        arr = arr.mean(axis=0)
                    frames.append(arr.astype(np.float32))
                container.close()
                if not frames:
                    raise RuntimeError("No audio frames")
                audio = np.concatenate(frames)
                # Write 16-bit PCM wav
                pcm = np.clip(audio, -1.0, 1.0)
                pcm_i16 = (pcm * 32767.0).astype(np.int16)
                with wave.open(out.name, "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(int(sample_rate))
                    wf.writeframes(pcm_i16.tobytes())
            except Exception as err:
                os.unlink(tmp.name)
                if os.path.exists(out.name):
                    os.unlink(out.name)
                raise HTTPException(
                    status_code=400,
                    detail=f"Could not decode audio (install ffmpeg): {err}",
                ) from err
        os.unlink(tmp.name)
        return out.name
    except HTTPException:
        raise
    except FileNotFoundError as err:
        os.unlink(tmp.name)
        if os.path.exists(out.name):
            os.unlink(out.name)
        raise HTTPException(
            status_code=500,
            detail="ffmpeg not found on PATH — required to decode webm/opus",
        ) from err


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    if _whisper is None:
        raise HTTPException(status_code=503, detail="Whisper model not loaded")

    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio")
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio exceeds 25MB")

    name = audio.filename or "audio.webm"
    suffix = Path(name).suffix or ".webm"
    wav_path = _audio_to_wav_path(data, suffix)

    try:
        try:
            segments, info = _whisper.transcribe(
                wav_path,
                beam_size=5,
                vad_filter=True,
                language=None,
            )
            texts: list[str] = []
            logprobs: list[float] = []
            for seg in segments:
                texts.append(seg.text.strip())
                if seg.avg_logprob is not None:
                    logprobs.append(float(seg.avg_logprob))

            text = " ".join(t for t in texts if t).strip()
            avg_logprob = float(np.mean(logprobs)) if logprobs else -10.0
            duration = float(getattr(info, "duration", 0.0) or 0.0)
            language = getattr(info, "language", None) or "unknown"

            return {
                "text": text,
                "durationSec": round(duration, 2),
                "language": language,
                "avgLogprob": round(avg_logprob, 4),
            }
        except HTTPException:
            raise
        except Exception as err:
            log.error(
                "Whisper transcribe failed: %s\n%s",
                type(err).__name__,
                traceback.format_exc(),
            )
            raise HTTPException(
                status_code=500,
                detail=f"{type(err).__name__}: {err}",
            ) from err
    finally:
        if os.path.exists(wav_path):
            os.unlink(wav_path)


def _synth_to_wav(text: str, wf) -> None:
    v = _piper_voice
    if hasattr(v, "synthesize_wav"):  # piper-tts >= 1.3
        v.synthesize_wav(text, wf)
        return
    try:
        v.synthesize(text, wf)  # old API
        return
    except TypeError:
        pass
    first = True  # chunk API fallback
    for chunk in v.synthesize(text):
        if first:
            wf.setnchannels(getattr(chunk, "sample_channels", 1))
            wf.setsampwidth(getattr(chunk, "sample_width", 2))
            wf.setframerate(getattr(chunk, "sample_rate", 22050))
            first = False
        wf.writeframes(chunk.audio_int16_bytes)


@app.post("/synthesize")
def synthesize(body: SynthesizeBody):
    if _piper_voice is None:
        raise HTTPException(
            status_code=503,
            detail=f"Piper voice missing — run scripts/download_voice.py (expected {VOICE_ONNX})",
        )

    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        _synth_to_wav(text, wf)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="audio/wav",
        headers={"Content-Disposition": 'inline; filename="question.wav"'},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=int(os.environ.get("SPEECH_PORT", "8001")),
        reload=False,
    )
