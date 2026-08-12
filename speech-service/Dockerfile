# Local STT/TTS — faster-whisper + Piper (CPU image; GPU optional via host runtime)
FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY requirements-docker.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py run.py ./
COPY scripts ./scripts
COPY voices ./voices

# Ensure Piper voice is present (script is a no-op if already vendored)
RUN python scripts/download_voice.py

ENV SPEECH_HOST=0.0.0.0
ENV SPEECH_PORT=8001
ENV WHISPER_MODEL=small
ENV WHISPER_MODEL_CPU=small
ENV PIPER_VOICE=en_US-lessac-medium

EXPOSE 8001
CMD ["python", "run.py"]
