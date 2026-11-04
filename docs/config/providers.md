# Providers

Mirror Mate uses external providers for LLM (language model), TTS (text-to-speech), STT (speech-to-text), VLM (vision language model), and Embedding (vector generation). Providers are configured in `config/providers.yaml`.

## Configuration

```yaml
providers:
  llm:
    enabled: true
    provider: openai  # openai or ollama
    # ...

  tts:
    enabled: true
    provider: elevenlabs
    # ...

  stt:
    enabled: true
    provider: openai  # openai or local
    wakeWord:
      provider: local
    # ...

  vlm:
    enabled: true
    provider: openai  # openai or ollama
    # ...

  embedding:
    enabled: true
    provider: openai  # openai or ollama
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

::: tip Set a spend limit
The default setup uses this key for replies, speech after the wake word, memory and the camera, so set a hard spend limit on its project. In the project's settings, select **Limits**, then under **Spend** select **Edit spend limit**, enter a monthly limit, turn on **Enforce a hard limit** and save. Requests past it fail with a 429, and the pages say the limit was reached. Enforcement isn't instant, so spend can go slightly past it. See [OpenAI's spend limits](https://developers.openai.com/api/docs/guides/spend-limits).
:::

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

`localhost` works under `bun run dev`. Under `docker compose`, it's the app's own container, so use the IP address of the machine running Ollama, as in [Services on Another Machine](#services-on-another-machine).

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

::: tip Opt out of model training
ElevenLabs uses some of the data you send it to improve its models, unless you opt out. Click your profile icon, go to **Terms and privacy** > **Data use**, turn off **Improve the models for everyone** and click **Update your choice**. It applies to what you send from then on. See [ElevenLabs' help page](https://elevenlabs.io/docs/help-center/legal/is-my-data-used-to-improve-eleven-labs-ai-models).
:::

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

The free plan includes 10,000 credits a month. `eleven_v4_turbo` cost 0.2 to 0.5 credits per character in testing, so a 100-character reply costs 20 to 50. When credits run out, ElevenLabs answers with a 401 whose `detail.status` is `quota_exceeded`. Replies then appear on screen without being spoken, and both pages say "Speech: ElevenLabs is out of credit." See [When something fails](#when-something-fails).

---

## STT Providers (Speech-to-Text)

STT providers enable speech recognition for voice input. Mirror Mate supports multiple providers with automatic silence detection.

> **Note**: Both providers take their language from [Locale Presets](presets.md) unless you set one.

| Provider | Description | API Key Required | Accuracy |
|----------|-------------|------------------|----------|
| OpenAI | Cloud API (`gpt-transcribe`) | Yes | Excellent |
| Local Whisper | Self-hosted (`speaches`) | No | Good with `small` |

### Wake Word Audio

While Mirror Mate waits for the wake word, it records everything said in the room, including by guests and the TV, to look for the phrase. That audio only goes to local Whisper, so it stays on your machine. `stt.provider` only hears what's said after the wake word.

```yaml
providers:
  stt:
    enabled: true
    provider: openai  # What's said after the wake word
    wakeWord:
      provider: local  # Everything heard before it
      maxRecordingDuration: 10000
      overlap: 3000
    local:
      baseUrl: "http://whisper:8000"
      model: Systran/faster-whisper-small
```

- `local` is the only choice for `wakeWord.provider`, and the default. Any other value turns the wake word off rather than send room audio elsewhere.
- If local Whisper is down, the wake word stops working, and both pages say "Wake word: Local Whisper can't be reached." Nothing falls back to `stt.provider`.
- A recording counts as wake word audio if Mirror Mate was waiting for the wake word at any point while it was made, such as one that started in a conversation that timed out before it ended.
- While waiting, a recording is cut `maxRecordingDuration` ms after its sound starts, so someone talking can't delay the wake word until they stop. The next recording starts `overlap` ms before the cut, so a phrase said at the cut is whole in it. The overlap has to be longer than the phrase, and shorter than `maxRecordingDuration`.

::: warning
With the wake word off (`wakeWord.enabled: false` in the [character config](character.md)), there's nothing to wait for, so everything said in the room goes to `stt.provider`. With `provider: openai`, that means OpenAI hears and bills it all.
:::

### OpenAI Transcription

High-accuracy speech recognition using OpenAI's `gpt-transcribe`. It's what an `stt` section without `provider` uses.

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

### Local Whisper (speaches)

Self-hosted Whisper, which hears the wake word, and everything else too with `provider: local`. `compose.yaml` runs [speaches](https://github.com/speaches-ai/speaches) next to the app, with an OpenAI-compatible API and no published port.

```yaml
providers:
  stt:
    enabled: true
    provider: local  # Or keep openai, and use local Whisper only for the wake word
    local:
      baseUrl: "http://whisper:8000"  # The whisper service in compose.yaml
      model: Systran/faster-whisper-small
      language: ja
```

`speaches` answers short names such as `small` with a 404, so give the full model ID. `compose.yaml` downloads `Systran/faster-whisper-small` on the first start.

See [Docker Documentation](/guide/docker) for details.

#### Models

Measured on one x86 machine, on the wake word in English and German. `small` ran on `speaches`, and the others on an older Whisper server, which used about 0.4 GB less for `small`:

| Model | Wake words recognized | Per recording, 16 cores | Memory |
|-------|-----------------------|-------------------------|--------|
| `Systran/faster-whisper-tiny` | Fewest, with misspellings such as "Kalumira" | ~0.3 s | ~0.7 GB |
| `Systran/faster-whisper-base` | All of one real voice, fewer synthesized ones | ~0.5 s | ~0.9 GB |
| `Systran/faster-whisper-small` | Most | ~1.2 s | ~2.6 GB |

### Silence Detection

Both providers use automatic silence detection to determine when the user has finished speaking.

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
| `provider` | string | `openai` or `local`, for what's said after the wake word | `openai` |
| `wakeWord.provider` | string | `local`, for everything heard before the wake word | `local` |
| `wakeWord.maxRecordingDuration` | number | While waiting, ms after its sound starts that a recording is cut | `10000` |
| `wakeWord.overlap` | number | ms the next recording starts before the cut | `3000` |
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

Pull the model where Ollama runs (`ollama pull bge-m3`), then:

```yaml
providers:
  embedding:
    enabled: true
    provider: ollama
    ollama:
      model: bge-m3
      baseUrl: "http://localhost:11434"  # An IP address under docker compose
```

#### Recommended Embedding Models

| Model | Dimensions | Description |
|-------|------------|-------------|
| `bge-m3` | 1024 | Multilingual, including Japanese (the default) |
| `nomic-embed-text` | 768 | Fast, English-focused |

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

## When something fails

When a request to a provider fails, the avatar page shows why under the mic status, and `/control` shows it at the top, such as "Voice input: OpenAI rejected the API key." The line goes away once a request of the same kind works again. Each part has its own line: the wake word, voice input after it, replies and speech.

| Message | Cause |
|---------|-------|
| has no API key | `OPENAI_API_KEY` or `ELEVENLABS_API_KEY` isn't set |
| rejected the API key | A wrong or revoked key |
| lacks a permission this needs | A restricted key without the permission, such as ElevenLabs Text to Speech |
| is out of credit | OpenAI's `insufficient_quota`, or ElevenLabs' `quota_exceeded` |
| reached the monthly spending limit set for it | A hard spend limit on the OpenAI project or organization |
| is limiting requests | A rate limit |
| can't be reached | The service is down, or the network is |
| returned an error | Any other error, which the server log has |

After a missing or rejected key, a missing permission, no credit, a spending limit or a rate limit, the avatar page stops asking for that kind of request for 30 seconds, then twice as long each time it fails again, up to 10 minutes. A rate limit that says how long to wait is waited out instead. Asking again on every utterance wouldn't help, so what's said meanwhile is dropped. `/control` still sends what you type each time.

The app asks OpenAI once per request, without the SDK's own retries, which would also retry a 429 for an account out of credit.

The avatar page also needs its speech settings from the app's own server (`/api/stt/config`) before it records anything. If they can't be loaded, it doesn't listen, and the voice input line says why, such as "Voice input: The server can't be reached." Reload the page once the server is back.

---

## Services on Another Machine

Ollama and local Whisper can run on another machine, such as one with a GPU, or when a Raspberry Pi can't spare the memory for Whisper. The app reaches them by that machine's IP address, such as its Tailscale IP (`tailscale ip -4`). Under `docker compose`, `localhost` is the app's own container, so use the IP address even for Ollama on the same machine.

Mirror Mate sends neither of them a key, so anything that reaches their ports can use them. Keep those machines on a trusted network, such as Tailscale, or restrict their ports with a firewall. Restart the app after changing `config/providers.yaml`.

### Ollama

Ollama only listens on localhost unless told otherwise, so start it with `OLLAMA_HOST=0.0.0.0` on its machine. Then set `baseUrl` for each provider that uses it:

```yaml
# config/providers.yaml
providers:
  llm:
    provider: ollama
    ollama:
      model: "gpt-oss:20b"
      baseUrl: "http://100.x.x.x:11434"

  embedding:
    provider: ollama
    ollama:
      model: bge-m3
      baseUrl: "http://100.x.x.x:11434"

  vlm:
    provider: ollama
    ollama:
      model: llava:7b
      baseUrl: "http://100.x.x.x:11434"
```

### Local Whisper

Whisper on another machine hears everything said in the room while Mirror Mate waits for the wake word, so only use a machine you trust with that. Run `speaches` there with the image and settings from `compose.yaml`, publishing its port on the address the app reaches it by. Docker can only publish on an address that exists when the container starts, so Tailscale must be up first:

```bash
docker run -d --name whisper --restart unless-stopped \
  -p 100.x.x.x:8000:8000 \
  -e 'PRELOAD_MODELS=["Systran/faster-whisper-small"]' \
  -e ENABLE_UI=false -e WHISPER__INFERENCE_DEVICE=cpu -e STT_MODEL_TTL=-1 \
  -v whisper-models:/home/ubuntu/.cache/huggingface/hub \
  ghcr.io/speaches-ai/speaches:0.9.0-rc.3-cpu@sha256:2163775b6df5e451a71200e8f675fed68dbd8ab184fc604453d549e486f22fd2
```

Then point the app at it:

```yaml
providers:
  stt:
    local:
      baseUrl: "http://100.x.x.x:8000"
      model: Systran/faster-whisper-small
```

`compose.yaml` would still start its own Whisper as well, so start only the app:

```bash
docker compose up -d --no-deps mirrormate
```

See [Docker Setup](/guide/docker) for details.
