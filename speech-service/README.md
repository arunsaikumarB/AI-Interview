# Speech service (local STT / TTS)

FastAPI service on **http://localhost:8001** for voice interviews.

- **STT:** [faster-whisper](https://github.com/SYSTRAN/faster-whisper) — `medium` on CUDA (`int8_float16`), falls back to `small` on CPU
- **TTS:** [Piper](https://github.com/rhasspy/piper) — bundled English voice `en_US-lessac-medium`

**Never uses cloud STT/TTS**, regardless of `AI_PROVIDER`.

## Setup

```bash
cd speech-service
python -m venv .venv

# Windows
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python scripts\download_voice.py
.\.venv\Scripts\python run.py

# macOS / Linux
source .venv/bin/activate
pip install -r requirements.txt
python scripts/download_voice.py
python run.py
```

Or on Windows: `.\run.ps1`

### Piper voice download

The `.onnx` model is **not committed**. `scripts/download_voice.py` fetches:

- `voices/en_US-lessac-medium.onnx`
- `voices/en_US-lessac-medium.onnx.json`

from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) (`en/en_US/lessac/medium`).

### ffmpeg

Decoding browser `webm`/`opus` uploads needs **ffmpeg** on `PATH`.

## Endpoints

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/health` | — | `{ ok, device, whisperModel, voice }` |
| POST | `/transcribe` | multipart `audio` | `{ text, durationSec, language, avgLogprob }` |
| POST | `/synthesize` | `{ text }` | `audio/wav` stream |

## Env

| Var | Default | Notes |
|-----|---------|-------|
| `SPEECH_PORT` | `8001` | Bind port |
| `PIPER_VOICE` | `en_US-lessac-medium` | Voice basename under `voices/` |
| `WHISPER_MODEL` | `medium` | CUDA |
| `WHISPER_MODEL_CPU` | `small` | CPU fallback |
| `AVG_LOGPROB_FAIL` | `-1.2` | Used by Next.js client threshold (service returns raw score) |
