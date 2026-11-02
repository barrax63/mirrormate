# Providers

Mirror Mate uses external providers for LLM (language model), TTS (text-to-speech), STT (speech-to-text), VLM (vision language model), and Embedding (vector generation). Providers are configured in `config/providers.yaml`.

## Configuration

```yaml
providers:
  llm:
    enabled: true
    provider: ollama  # openai or ollama
    # ...

  tts:
    enabled: true
    provider: elevenlabs
    # ...

  stt:
    enabled: true
    provider: web  # openai, local, or web
    # ...

  vlm:
    enabled: true
    provider: ollama
    # ...

  embedding:
    enabled: true
    provider: ollama
    # ...

  memory:
    enabled: true
    # ...
```

---

## LLM Providers

| Provider | Description | API Key Required |
|----------|-------------|------------------|
| OpenAI | `gpt-6-luna` | Yes |
| Ollama | Local LLM hosting | No |

### OpenAI

1. Get an API key from [OpenAI](https://platform.openai.com/api-keys)
2. Add to `.env`:

```bash
OPENAI_API_KEY=sk-your-api-key-here
```

3. Configure in `providers.yaml`:

```yaml
providers:
  llm:
    enabled: true
    provider: openai
    openai:
      model: gpt-6-luna
      maxTokens: 300
      temperature: 0.7
```

#### Models

`gpt-6-luna` is the default. The provider turns its reasoning off with `reasoning_effort: "none"`, since tools and `temperature` only work that way, and sends `maxTokens` as `max_completion_tokens`.

Models without reasoning, such as `gpt-4o-mini`, reject `reasoning_effort` with a 400, so they don't work with this provider. OpenAI shuts `gpt-4o-mini` down on January 14, 2027.

### Ollama

[Ollama](https://ollama.com/) allows running LLMs locally without API costs.

1. Install Ollama:

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

2. Start Ollama server:

```bash
ollama serve
```

3. Pull a model:

```bash
ollama pull gpt-oss:20b
```

4. Configure in `providers.yaml`:

```yaml
providers:
  llm:
    enabled: true
    provider: ollama
    ollama:
      model: "gpt-oss:20b"
      baseUrl: "http://localhost:11434"
      maxTokens: 300
      temperature: 0.7
```

#### Recommended Models for Japanese

| Model | Size | Japanese Quality | Tool Calling | Speed |
|-------|------|------------------|--------------|-------|
| `gpt-oss:20b` | 20B | Excellent | Native | Medium |
| `qwen2.5:14b` | 14B | Very Good | Yes | Medium |
| `qwen2.5:32b` | 32B | Excellent | Yes | Slow |

### LLM Options

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `provider` | string | `openai` or `ollama` | `openai` |
| `model` | string | Model name/ID | varies |
| `maxTokens` | number | Maximum response length | 300 |
| `temperature` | number | Creativity (0.0-1.0) | 0.7 |
| `baseUrl` | string | API endpoint (Ollama only) | `http://localhost:11434` |
| `historyLimit` | number | Most recent messages of the conversation sent with each request. Set directly under `llm`, for either provider | 20 |

Every message sent again costs tokens on a paid LLM, so each request carries only the last `historyLimit` messages, starting at a question.

> **Note**: With `gpt-oss:20b`, reasoning counts against `maxTokens`. At 300, longer prompts such as the `good night` rule use up the limit before any reply is written, so the response is empty. Raising `maxTokens` helps, though gpt-oss can still occasionally return an empty reply.

---

## TTS Providers

| Provider | Description | API Key Required |
|----------|-------------|------------------|
| ElevenLabs | `eleven_v4_turbo`, one voice for every language | Yes |

### ElevenLabs

1. Get an API key from [ElevenLabs](https://elevenlabs.io/app/settings/api-keys). It needs the Text to Speech permission, and Voices read access for the voice selector on `/control`.
2. Add to `.env`:

```bash
ELEVENLABS_API_KEY=your-api-key
```

3. Configure in `providers.yaml`:

```yaml
providers:
  tts:
    enabled: true
    provider: elevenlabs
    elevenlabs:
      voiceId: EXAVITQu4vr4xnSDxMaL  # Sarah, until a voice is picked on /control
      model: eleven_v4_turbo
```

| Option | Description | Default |
|--------|-------------|---------|
| `voiceId` | ElevenLabs voice ID, used until one is picked on `/control` | `EXAVITQu4vr4xnSDxMaL` (Sarah) |
| `model` | ElevenLabs model ID | `eleven_v4_turbo` |
| `baseUrl` | API address | `https://api.elevenlabs.io` |

Speech follows the app's locale. Emoji and markdown are removed before speaking, though the reply on screen keeps them.

The voice selector on `/control` lists the account's voices, the default ones and any you've added, as they were when the app started. Restart it to see voices added since. A character's `recommendedVoice` in `characters.yaml` is a voice ID from that list, and picking the character picks its voice.

The free plan includes 10,000 credits a month. `eleven_v4_turbo` cost 0.2 to 0.5 credits per character in testing, so a 100-character reply costs 20 to 50. When credits run out, ElevenLabs answers with a 401 whose `detail.status` is `quota_exceeded`, and replies appear on screen without being spoken.

---

## STT Providers (Speech-to-Text)

STT providers enable speech recognition for voice input. Mirror Mate supports multiple providers with automatic silence detection.

> **Note**: The Whisper providers (`openai`, `local`) take their language from [Locale Presets](presets.md) unless you set one. The Web Speech API always starts in `en-US`, whatever the locale or `web.language`.

| Provider | Description | API Key Required | Accuracy |
|----------|-------------|------------------|----------|
| Web Speech API | Browser native (Chrome/Edge) | No | Good |
| OpenAI | Cloud API (`gpt-transcribe`) | Yes | Excellent |
| Local Whisper | Self-hosted (faster-whisper) | No | Excellent |

### Web Speech API (Default)

Uses the browser's built-in speech recognition. Best for quick setup with no additional configuration.

```yaml
providers:
  stt:
    enabled: true
    provider: web
```

**Pros**: Zero cost, instant setup, real-time interim results
**Cons**: Browser-dependent quality, requires Chrome/Edge

> **Note**: Brave has the API, but every session fails with a `network` error, so voice input stays on "Paused". Use a Whisper provider in Brave.

### OpenAI Transcription

High-accuracy speech recognition using OpenAI's `gpt-transcribe`.

```yaml
providers:
  stt:
    enabled: true
    provider: openai
    openai:
      model: gpt-transcribe
      language: ja  # ISO 639-1 code (or omit for auto-detect)
      temperature: 0
```

The provider sends the language as `languages`, and the names of the configured characters as `keywords`, so that names such as Mira are spelled as configured. OpenAI shuts `whisper-1` down on February 26, 2027.

**Pros**: Excellent accuracy, many languages, returned nothing for silence and noise in testing, where Whisper invents text
**Cons**: API cost ($0.0045/minute), requires internet

### Local Whisper (faster-whisper)

Self-hosted Whisper for privacy and cost savings. Uses [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) with OpenAI-compatible API.

```yaml
providers:
  stt:
    enabled: true
    provider: local
    local:
      baseUrl: "http://studio:8080"  # Your whisper server
      model: large-v3  # tiny, base, small, medium, large-v3
      language: ja
```

#### Setup with Docker

```bash
# On Mac Studio (or any server)
docker compose -f compose.studio.yaml up -d faster-whisper
```

See [Docker Documentation](/guide/docker) for details.

#### Models

| Model | Size | Accuracy | Speed (30s audio) |
|-------|------|----------|-------------------|
| `tiny` | 39M | Low | ~2s |
| `base` | 74M | Medium | ~4s |
| `small` | 244M | Good | ~8s |
| `medium` | 769M | Very Good | ~12s |
| `large-v3` | 1.5G | Excellent | ~15s |

*Speed measured on Apple M1/M2 Ultra (CPU mode)*

### Silence Detection

The Whisper providers (`openai`, `local`) use automatic silence detection to determine when the user has finished speaking. The Web Speech API handles this in the browser and ignores these settings.

```yaml
providers:
  stt:
    silenceDetection:
      silenceThreshold: 1.5      # Seconds of silence before sending
      volumeThreshold: 0.02      # RMS volume threshold (0-1)
      minRecordingDuration: 500  # Minimum recording time (ms)
      maxRecordingDuration: 60000 # Maximum recording time (ms)
```

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `silenceThreshold` | number | Seconds of silence before auto-send | `1.5` |
| `volumeThreshold` | number | RMS volume below which is silence | `0.02` |
| `minRecordingDuration` | number | Min time before silence detection (ms) | `500` |
| `maxRecordingDuration` | number | Max recording duration (ms) | `60000` |

### STT Options Summary

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `provider` | string | `web`, `openai`, or `local` | `web` |
| `openai.model` | string | OpenAI transcription model | `gpt-transcribe` |
| `openai.language` | string | Language code (ISO 639-1) | auto |
| `local.baseUrl` | string | Whisper server URL | `http://localhost:8080` |
| `local.model` | string | Model name | `base` |
| `local.language` | string | Language code | auto |

---

## VLM Providers (Vision Language Model)

VLM providers enable visual understanding through the `see_camera` tool.

| Provider | Description | API Key Required |
|----------|-------------|------------------|
| OpenAI | `gpt-6-luna`, which accepts images | Yes |
| Ollama | Local vision models (llava, moondream) | No |

### OpenAI VLM

```yaml
providers:
  vlm:
    enabled: true
    provider: openai
    openai:
      model: gpt-6-luna
```

Camera frames go to OpenAI when the LLM calls `see_camera`. Like the LLM provider, it turns reasoning off with `reasoning_effort: "none"`.

### Ollama VLM

```yaml
providers:
  vlm:
    enabled: true
    provider: ollama
    ollama:
      model: llava:7b  # or moondream, granite3.2-vision
      baseUrl: "http://localhost:11434"
```

#### Recommended Vision Models

| Model | Size | Description | Speed |
|-------|------|-------------|-------|
| `moondream` | 1.8B | Lightweight, edge-friendly | Fast |
| `llava:7b` | 7B | Good balance of quality/speed | Medium |
| `granite3.2-vision` | 2B | Document understanding | Medium |

### Usage

When VLM is enabled and the user asks visual questions, the LLM will use the `see_camera` tool:

```
User: "何を持ってるかわかる？"
AI: [calls see_camera tool]
AI: "スマートフォンを持っていますね！"
```

---

## Embedding Providers

Embedding providers generate vector representations of text for semantic search.

| Provider | Description | API Key Required |
|----------|-------------|------------------|
| OpenAI | `text-embedding-3-small` | Yes |
| Ollama | Local embedding models | No |

Each memory's vector is stored with the name of the model that made it, and search only compares vectors from the current model, since vectors from different models can't be compared. After a change of provider or model, the next chat request embeds the other memories with the new model before it searches, so that reply takes longer.

### OpenAI Embedding

```yaml
providers:
  embedding:
    enabled: true
    provider: openai
    openai:
      model: text-embedding-3-small
```

### Ollama Embedding

```yaml
providers:
  embedding:
    enabled: true
    provider: ollama  # PLaMo server provides Ollama-compatible API
    ollama:
      model: plamo-embedding-1b
      baseUrl: "http://studio:8000"  # PLaMo embedding server
```

#### Recommended Embedding Models

| Model | Dimensions | Description |
|-------|------------|-------------|
| `plamo-embedding-1b` | 2048 | Japanese-optimized, top JMTEB scores (recommended) |
| `bge-m3` | 1024 | Multi-lingual, good quality (alternative) |
| `nomic-embed-text` | 768 | Fast, English-focused |

### Setup

#### Option 1: PLaMo-Embedding-1B (Recommended for Japanese)

PLaMo-Embedding-1B provides superior Japanese text embedding. See [Recommended Setup](/guide/recommended-setup) for full instructions.

```bash
# On Mac Studio
docker compose -f compose.studio.yaml up -d
```

#### Option 2: Ollama with bge-m3 (Alternative)

```bash
ollama serve
ollama pull bge-m3
```

```yaml
providers:
  embedding:
    enabled: true
    provider: ollama
    ollama:
      model: bge-m3
      baseUrl: "http://localhost:11434"
```

---

## Memory Configuration

Memory system enables persistent user context through RAG (Retrieval-Augmented Generation).

```yaml
providers:
  memory:
    enabled: true
    # RAG settings
    rag:
      topK: 8           # Max memories to retrieve
      threshold: 0.3    # Minimum similarity score (0.0-1.0)
    # Memory extraction settings
    extraction:
      autoExtract: true      # Auto-extract from conversations
      minConfidence: 0.5     # Minimum confidence for extraction
```

### Options

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `enabled` | boolean | Enable memory system | `false` |
| `rag.topK` | number | Max memories to retrieve per query | `8` |
| `rag.threshold` | number | Similarity threshold (0.0-1.0) | `0.3` |
| `extraction.autoExtract` | boolean | Auto-extract memories from conversations | `true` |
| `extraction.minConfidence` | number | Minimum confidence for extraction | `0.5` |

### Memory Types

| Type | Description |
|------|-------------|
| `profile` | User preferences, traits, persistent info |
| `episode` | Recent interactions and events |
| `knowledge` | Facts and learned information |

See [Memory Documentation](/guide/memory) for details.

---

## Remote Server Configuration

Recommended setup: Run heavy services (Ollama, PLaMo) on a powerful server (e.g., Mac Studio) and connect via Tailscale:

```yaml
# config/providers.yaml
providers:
  llm:
    provider: ollama
    ollama:
      model: "gpt-oss:20b"
      baseUrl: "http://studio:11434"  # Tailscale hostname

  embedding:
    enabled: true
    provider: ollama  # PLaMo server provides Ollama-compatible API
    ollama:
      model: plamo-embedding-1b
      baseUrl: "http://studio:8000"  # PLaMo embedding server

  memory:
    enabled: true
    rag:
      topK: 8
      threshold: 0.3
    extraction:
      autoExtract: true
      minConfidence: 0.5
```

See [Docker Documentation](/guide/docker) for details.
