# Getting Started

Mirror Mate is a voice-first AI companion for a smart mirror. It runs on your machine with Docker, on a Raspberry Pi or anything else. OpenAI writes its replies and ElevenLabs reads them aloud, while a local Whisper container listens for the wake word, so nothing said in the room before it leaves your machine.

## What You Need

- **Docker** with Compose, on a machine with about 3 GB of memory to spare for Whisper
- **Chrome or Brave** on the same machine, with a microphone and speakers
- **An OpenAI API key**, from [platform.openai.com](https://platform.openai.com)
- **An ElevenLabs API key**, from [elevenlabs.io](https://elevenlabs.io), with the Text to Speech permission, and Voices read access for the voice selector on `/control`

## Quick Start

```bash
git clone https://github.com/barrax63/mirrormate.git
cd mirrormate
cp .env.example .env    # set OPENAI_API_KEY and ELEVENLABS_API_KEY in it
docker compose up -d
```

This builds the app and starts it with local Whisper. The first start also downloads the Whisper model, about half a gigabyte, and the app only starts once Whisper is ready, so give it a few minutes. `docker compose ps` shows both running when it's done.

Then:

1. Open http://localhost:3000 in Chrome or Brave.
2. Allow the microphone when the browser asks.
3. Click anywhere on the page once, so the browser lets it play sound.
4. Say **"Hey Mira"**. When the page shows "In Conversation", ask something, such as "What's the weather like today?"

The conversation lasts until nothing has been said for 60 seconds. Then the page waits for the wake word again.

Open http://localhost:3000/control in the same browser to type instead, turn the mic off, pick a voice or character, and turn the camera off with the Vision toggle. The two pages talk to each other through the browser, so `/control` doesn't work from another one.

### Recommended Account Settings

`.env.example` describes both:

- **A hard spend limit on the OpenAI project** the key belongs to, so a bug or a busy room can't run up a bill. Requests past it fail, and the pages say so.
- **Turning off "Improve the models for everyone"** in ElevenLabs, under your profile icon, Terms and privacy, Data use. Otherwise ElevenLabs may use what you send it to train its models.

### Updating

```bash
git pull
docker compose up -d --build
```

## What Leaves This Machine

| What | Where it goes | When |
|------|---------------|------|
| Everything said in the room | Nowhere: local Whisper, on this machine | While it waits for the wake word |
| What you say after the wake word, as audio | OpenAI (`gpt-transcribe`) | Every utterance in a conversation |
| The conversation, your memories and the reply | OpenAI (`gpt-6-luna`) | Every reply, and memory extraction after it |
| Memories and what you said, as text | OpenAI (`text-embedding-3-small`) | To find related memories |
| A camera frame | OpenAI | Only when the AI looks, with the `see_camera` tool, and never while Vision is off on `/control`. The `/control/vision` test page also sends frames while you use it |
| The reply text | ElevenLabs | Every reply, to read it aloud |

- **ElevenLabs** offers zero retention only on its Enterprise plan, and may use what you send it to train its models unless you turn that off, as above.
- **Other services** only get what they need: Open-Meteo the configured location for the weather, and Wikipedia the date for the morning greeting's "on this day". Google Calendar, web search (Ollama's) and Discord only work when you set them up, and then get the calendar request, the search query and what's shared.
- **Memories** stay in the SQLite database on this machine. You can read, edit and delete them at `/control/memory`.
- **Logs** don't hold what's said, heard or seen. Transcripts, replies and camera descriptions show up only as their length.

To keep more of it on your own hardware, see [Optional: Ollama and Local Whisper](#optional-ollama-and-local-whisper).

## What It Costs

Measured over an 8-reply conversation in English on 2026-11-07, at the prices on 2026-11-01:

| Per reply | Cost | Measured |
|-----------|------|----------|
| OpenAI: the reply, memory extraction and embeddings | $0.0002 to $0.0004 | The most with a tool call |
| OpenAI: transcribing what you said | $0.0003 to $0.0008 | For a 4 to 10 s recording, at $0.0045 a minute |
| ElevenLabs: reading the reply aloud | 9 to 58 credits | About 20 for a 100-character reply |

- **OpenAI:** about $1 per 1,000 replies. `gpt-6-luna` costs $0.10 per 1M input tokens and $0.50 per 1M output tokens, and a reply used about 600 to 1,300 input tokens, plus a memory extraction call of about 600 to 900. Each request carries the last 20 messages of the conversation at most (`providers.llm.historyLimit`).
- **ElevenLabs:** `eleven_v4_turbo` charged 0.2 credits per character in this test, and up to 0.5 in earlier ones. The free plan has 10,000 credits a month, enough for about 500 replies, and Starter, at $6 a month, has 30,000.
- **Waiting for the wake word** costs nothing, since local Whisper does it.
- **Long sounds after the wake word** do cost: a room full of talk or music gets transcribed until the conversation times out, at $0.0045 a minute.

## Pages

| Path | Description |
|------|-------------|
| `/` | Avatar display (for mirror projection) |
| `/control` | Control panel (text input & settings) |
| `/control/memory` | Memory management UI |
| `/control/vision` | Vision test page |
| `/demo` | Animation demo with keyboard controls |

## Configuration

All configuration is done via YAML files in the `config/` directory. Restart the app after editing them, with `docker compose restart mirrormate`.

| File | Description |
|------|-------------|
| `app.yaml` | Application settings (language/locale) |
| `presets/[lang].yaml` | Locale-specific defaults (timezone, weather, STT language, voice) |
| `providers.yaml` | LLM, TTS, STT, embedding, memory and VLM provider settings |
| `features.yaml` | Weather, calendar, time, reminder and Discord settings |
| `plugins.yaml` | Visual widget plugins (clock, etc.) |
| `locales/[lang]/` | Language-specific configs (character, memory, rules, modules) |

### Language Support

English is the default. German and Japanese are built in. Set the language in `.env` and run `docker compose up -d`, which restarts the app with it:

```bash
LOCALE=de  # or en, ja
```

Or set it in `config/app.yaml`, which `LOCALE` overrides, and restart the app:

```yaml
app:
  locale: "en"  # or "de" for German, "ja" for Japanese
```

This single setting automatically configures:
- **Locale presets**: Time zone, weather locations, STT language, clock format and voice (`config/presets/[lang].yaml`)
- Character personality and speech style (`config/locales/[lang]/character.yaml`)
- Memory extraction prompts (`config/locales/[lang]/memory.yaml`)
- Rules and modules (`config/locales/[lang]/rules.yaml`, `modules.yaml`)
- Database file (`data/mirrormate.[lang].db`), so each language keeps its own memories
- Wikipedia API language for "today's info"

| Locale | Wake word | Voice | Timezone | Weather | Clock |
|--------|-----------|-------|----------|---------|-------|
| `en` | "Hey Mira" | Sarah | America/Los_Angeles | San Francisco, New York | 12h |
| `de` | "Hallo Mira" | Matilda | Europe/Berlin | Berlin, München | 24h |
| `ja` | "OK ミラ" | Sarah | Asia/Tokyo | Tokyo, Osaka | 24h |

In testing with synthesized voices, local Whisper often misheard the Japanese wake words, writing "OK 見た" or "オッケー、ミラー" for "OK ミラ".

You can customize these defaults by editing `config/presets/[lang].yaml`. See [Locale Presets](/config/presets) for details.

## Optional: Ollama and Local Whisper

To keep replies, memory and the camera on your own hardware, run [Ollama](https://ollama.com/) on a machine that can handle it, such as one with a GPU. Speech output still needs an ElevenLabs key.

```bash
# Where Ollama runs: listen beyond localhost, so the app's container can reach it
OLLAMA_HOST=0.0.0.0 ollama serve
ollama pull gpt-oss:20b
ollama pull bge-m3
ollama pull llava:7b
```

In `config/providers.yaml`, set `provider: ollama` for `llm`, `embedding` and `vlm`, and `baseUrl` under each of their `ollama` sections to the IP address of the machine running Ollama, such as `http://192.168.1.20:11434`. Use its IP address even if it's this machine: inside the container, `localhost` is the container itself. Then restart the app. See [Services on Another Machine](/config/providers#services-on-another-machine).

Ollama has no authentication, so only let it listen on a trusted network.

Local Whisper only hears the room until the wake word. To keep what's said after it local too, set `stt.provider: local` in `config/providers.yaml`. Otherwise it goes to OpenAI. With all of this local, `OPENAI_API_KEY` isn't needed.

### Whisper on Another Machine

`compose.yaml` runs Whisper next to the app, and `small` used up to 2.6 GB of memory in testing. On a machine that can't spare it, such as a 2 GB Raspberry Pi, run Whisper on another machine and point `stt.local.baseUrl` at it. That machine hears everything said in the room while the app waits for the wake word, so only use one you trust with it. See [Local Whisper](/config/providers#local-whisper) for the settings, and start only the app:

```bash
docker compose up -d --no-deps mirrormate
```

## Local Development

For development without Docker, you need Node 22 and [Bun](https://bun.sh/). `config/providers.yaml` expects Whisper at `http://whisper:8000`, the name Compose gives it, so run Whisper with a port on this machine and point a copy of the config at it:

```bash
bun install
cp .env.example .env    # set OPENAI_API_KEY and ELEVENLABS_API_KEY in it

# Local Whisper, published on this machine only
docker run -d --name mirrormate-whisper -p 127.0.0.1:8000:8000 \
  -e 'PRELOAD_MODELS=["Systran/faster-whisper-small"]' \
  -e ENABLE_UI=false -e WHISPER__INFERENCE_DEVICE=cpu -e STT_MODEL_TTL=-1 \
  -v mirrormate-whisper-models:/home/ubuntu/.cache/huggingface/hub \
  ghcr.io/speaches-ai/speaches:0.9.0-rc.3-cpu@sha256:2163775b6df5e451a71200e8f675fed68dbd8ab184fc604453d549e486f22fd2

# A copy of the providers config that reaches it there, which git ignores
sed 's#http://whisper:8000#http://localhost:8000#' config/providers.yaml > config/providers.local.yaml
PROVIDERS_CONFIG=providers.local.yaml bun run dev

# Run tests
bun run test
```

The development server runs on http://localhost:3000. Use `bun run test`, not `bun test`, which starts Bun's own test runner.

## Next Steps

- [Architecture Overview](/guide/architecture) - Understand how Mirror Mate works
- [Docker Setup](/guide/docker) - Detailed Docker configuration
- [Locale Presets](/config/presets) - Configure locale-specific settings
- [Providers](/config/providers) - Configure the LLM, speech and other providers
- [Character](/config/character) - Customize AI personality
