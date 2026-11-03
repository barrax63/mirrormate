# Getting Started

Mirror Mate is a self-hosted AI companion designed for smart mirror displays. This guide will help you get up and running quickly.

## Prerequisites

- **A Chromium browser** - Chrome or Brave
- **Docker** - Recommended for easy deployment
- **An OpenAI API key and an ElevenLabs API key** - For the default setup
- **Bun** - For local development (optional)

## Quick Start

### Option 1: OpenAI and ElevenLabs (default)

```bash
git clone https://github.com/barrax63/mirrormate.git
cd mirrormate
cp .env.example .env    # set OPENAI_API_KEY and ELEVENLABS_API_KEY
docker compose up -d
```

This starts the app and local Whisper, which listens for the wake word, so nothing said in the room before it leaves your machine. The first start downloads the Whisper model, about half a gigabyte. Open http://localhost:3000 and say **"Hey Mira"** to start talking.

Before you use it, `.env.example` recommends two settings in your accounts:

- **A hard spend limit on the OpenAI project** the key belongs to, so a bug or a busy room can't run up a bill. Requests past it fail, and the pages say so.
- **Turning off "Improve the models for everyone"** in ElevenLabs, under your profile icon, Terms and privacy, Data use. Otherwise ElevenLabs may use what you send it to train its models.

To use Japanese, see [Language Support](#language-support).

### Option 2: Ollama and local Whisper

To keep the LLM, embeddings and speech recognition on your own machine. Speech output still needs an ElevenLabs key:

```bash
# 1. Install and start Ollama
ollama serve
ollama pull gpt-oss:20b

# 2. Clone Mirror Mate and start PLaMo Embedding
git clone https://github.com/barrax63/mirrormate.git
cd mirrormate
docker compose -f compose.studio.yaml up -d

# 3. Set ELEVENLABS_API_KEY, and point Mirror Mate at those services (see below)
cp .env.example .env

# 4. Start Mirror Mate and local Whisper
docker compose up -d
```

In `config/providers.yaml`, set `provider: ollama` for `llm`, `embedding` and `vlm`, with `baseUrl: "http://studio:11434"` under `ollama` for the LLM and VLM, and `"http://studio:8000"` for embedding. Inside the container, `studio` is this machine, or the one `STUDIO_IP` in `.env` names.

Ollama must listen on an address the container can reach (`OLLAMA_HOST=0.0.0.0`). It has no authentication, so only do this on a trusted network.

Local Whisper only hears the room until the wake word. To keep what's said after it local too, set `stt.provider: local` in `config/providers.yaml`.

Open http://localhost:3000 in Chrome or Brave. Say **"Hey Mira"** (English) or **"OK ミラ"** (Japanese) to start talking!

## Pages

| Path | Description |
|------|-------------|
| `/` | Avatar display (for mirror projection) |
| `/control` | Control panel (text input & settings) |
| `/control/memory` | Memory management UI |
| `/control/vision` | Vision test page |
| `/demo` | Animation demo with keyboard controls |

## Configuration

All configuration is done via YAML files in the `config/` directory:

| File | Description |
|------|-------------|
| `app.yaml` | Application settings (language/locale) |
| `presets/[lang].yaml` | Locale-specific defaults (timezone, weather, STT) |
| `providers.yaml` | LLM, TTS, STT, embedding, memory and VLM provider settings |
| `features.yaml` | Weather, calendar, time, reminder and Discord settings |
| `plugins.yaml` | Visual widget plugins (clock, etc.) |
| `locales/[lang]/` | Language-specific configs (character, memory, rules, modules) |

### Language Support

Mirror Mate supports multiple languages with automatic locale presets. Set the locale in `config/app.yaml`:

```yaml
app:
  locale: "en"  # or "ja" for Japanese
```

This single setting automatically configures:
- **Locale presets**: Time zone, weather locations, STT language, clock format (`config/presets/[lang].yaml`)
- Character personality and speech style (`config/locales/[lang]/character.yaml`)
- Memory extraction prompts (`config/locales/[lang]/memory.yaml`)
- Rules and modules (`config/locales/[lang]/rules.yaml`, `modules.yaml`)
- Database file (`data/mirrormate.[lang].db`)
- Wikipedia API language for "today's info"

| Locale | Timezone | Weather | STT | Clock |
|--------|----------|---------|-----|-------|
| `ja` | Asia/Tokyo | Tokyo, Osaka | Japanese | 24h |
| `en` | America/Los_Angeles | San Francisco, New York | English | 12h |

::: warning Language limits
- **UI text** uses the locale at build time, because pages are prerendered. After changing the locale on a built app, rebuild to change UI text (`docker compose up -d --build`). `bun run dev` only needs a restart.
:::

You can customize these defaults by editing `config/presets/[lang].yaml`. See [Locale Presets](/config/presets) for details.

You can also set the locale via environment variable (overrides config file):

```bash
LOCALE=en  # or ja
```

## Local Development

For development without Docker:

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Run tests
bun run test
```

::: tip
This project uses [Bun](https://bun.sh/) as the package manager for faster installs.
:::

## Next Steps

- [Recommended Setup](/guide/recommended-setup) - Production setup with Tailscale, Mac Studio & Raspberry Pi
- [Architecture Overview](/guide/architecture) - Understand how Mirror Mate works
- [Docker Setup](/guide/docker) - Detailed Docker configuration
- [Locale Presets](/config/presets) - Configure locale-specific settings
- [Providers](/config/providers) - Configure LLM and TTS providers
- [Character](/config/character) - Customize AI personality
