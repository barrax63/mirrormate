<p align="center">
  <img src="docs/public/mirrormate.png" alt="MirrorMate" width="400">
</p>

<h1 align="center">MirrorMate</h1>

<p align="center">
  <strong>A personalized AI in a mirror</strong>
</p>

<p align="center">
  <em>AI doesn't have to live on a screen.</em>
</p>

<p align="center">
  <a href="https://orangekame3.dev/mirrormate/">Docs</a> •
  <a href="https://orangekame3.dev/mirrormate/guide/getting-started">Getting Started</a> •
  <a href="https://github.com/orangekame3/mirrormate/releases">Releases</a>
</p>

<p align="center">
  <a href="https://github.com/orangekame3/mirrormate/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://github.com/orangekame3/mirrormate/releases"><img src="https://img.shields.io/github/v/release/orangekame3/mirrormate" alt="Release"></a>
  <a href="https://github.com/orangekame3/mirrormate/actions"><img src="https://github.com/orangekame3/mirrormate/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

---



https://github.com/user-attachments/assets/e0f1f067-6b71-4022-afb3-f13d48e87a9b


---

## Why a mirror?

A mirror is something you already live with.
You glance at it in the morning. You check yourself before heading out.
In those few seconds, you could ask about the weather, check your schedule, or just chat.

MirrorMate puts AI into that everyday object.
No phone to pull out. No laptop to open.
Just talk to the mirror.

## What it is

- A voice-first AI designed to live behind a half mirror, on a Raspberry Pi or any machine that runs Docker
- Thinks with OpenAI and speaks with ElevenLabs, while listening for its wake word on your own machine
- Remembers you, with memories kept in a database on your machine

## What it is not

- Not a smart display
- Not another chat UI in a browser

---

## How it works

```
┌─────────────────────────────────────────────────────────────────┐
│                     Your machine (Docker)                       │
│  ┌───────────────┐  ┌────────────┐  ┌────────────────────────┐  │
│  │  Browser      │  │  Next.js   │  │  SQLite                │  │
│  │  (Chrome or   │◄─┤  app       │◄─┤  (memories, settings)  │  │
│  │  Brave) + mic │  │  port 3000 │  │                        │  │
│  └───────────────┘  └─────┬──────┘  └────────────────────────┘  │
│         ▲                 │         ┌────────────────────────┐  │
│         │                 ├────────►│  Whisper (wake word)   │  │
│         │                 │         └────────────────────────┘  │
│         │                 │ HTTPS                               │
└─────────┼─────────────────┼─────────────────────────────────────┘
          │                 ▼
          │   ┌─────────────────────────────────────────────────┐
          │   │                      Cloud                      │
          │   │  ┌────────────────────┐ ┌──────────────────┐    │
          │   │  │  OpenAI            │ │  ElevenLabs      │    │
          │   │  │  replies, memory,  │ │  speech output   │    │
          │   │  │  camera, speech    │ │                  │    │
          │   │  │  after the wake    │ │                  │    │
          │   │  │  word              │ │                  │    │
          │   │  └────────────────────┘ └──────────────────┘    │
          │   └─────────────────────────────────────────────────┘
          │
          └── Half mirror + monitor
```

Local Whisper hears the room and waits for the wake word, so nothing said before it leaves your machine. After the wake word, what you say goes to OpenAI, which writes the reply, and ElevenLabs reads it aloud.

---

## Quick Start

You need:

- **Docker** with Compose, on a machine with about 3 GB of memory to spare for Whisper
- **Chrome or Brave** on the same machine, with a microphone and speakers
- **An OpenAI API key**, from [platform.openai.com](https://platform.openai.com)
- **An ElevenLabs API key**, from [elevenlabs.io](https://elevenlabs.io), with the Text to Speech permission, and Voices read access for the voice selector

Then:

```bash
git clone https://github.com/barrax63/mirrormate.git
cd mirrormate
cp .env.example .env    # set OPENAI_API_KEY and ELEVENLABS_API_KEY in it
docker compose up -d
```

This builds the app and starts it with local Whisper. The first start also downloads the Whisper model, about half a gigabyte, and the app starts once Whisper is ready, so give it a few minutes. `docker compose ps` shows both running when it's done.

1. Open http://localhost:3000 in Chrome or Brave.
2. Allow the microphone when the browser asks.
3. Click anywhere on the page once. Browsers only play sound on a page you've clicked.
4. Say **"Hey Mira"**. When the page shows "In Conversation", ask something, such as "What's the weather like today?"

Open http://localhost:3000/control in the same browser to type instead, turn the mic off and pick a voice or character. The two pages talk to each other through the browser, so `/control` doesn't work from another one.

Before you leave it running, `.env.example` recommends two settings in your accounts:

- **A hard spend limit on the OpenAI project** the key belongs to, so a bug or a busy room can't run up a bill
- **Turning off "Improve the models for everyone"** in ElevenLabs, under your profile icon, Terms and privacy, Data use

To update, run `git pull` and then `docker compose up -d --build`.

---

## What leaves this machine

| What | Where it goes | When |
| ---- | ------------- | ---- |
| Everything said in the room | Nowhere: local Whisper, on this machine | While it waits for the wake word |
| What you say after the wake word, as audio | OpenAI (`gpt-transcribe`) | Every utterance in a conversation |
| The conversation, your memories and the reply | OpenAI (`gpt-6-luna`) | Every reply, and memory extraction after it |
| Memories and what you said, as text | OpenAI (`text-embedding-3-small`) | To find related memories |
| A camera frame | OpenAI | Only when the AI looks, with the `see_camera` tool, and never while Vision is off on `/control` |
| The reply text | ElevenLabs | Every reply, to read it aloud |

ElevenLabs offers zero retention only on its Enterprise plan, and may use what you send it to train its models unless you turn that off, as above. The weather comes from Open-Meteo for the configured location. Google Calendar, web search and Discord only work when you set them up. Memories stay in the database on this machine, at `/control/memory`, where you can read and delete them.

The logs don't hold what's said, heard or seen.

---

## What it costs

Measured on a real conversation in English, at the prices on 2026-11-01:

| Service | Per reply | What it covers |
| ------- | --------- | -------------- |
| OpenAI | COST_OPENAI | Transcribing the question, the reply, memory extraction and embeddings |
| ElevenLabs | COST_ELEVENLABS | Reading the reply aloud |

COST_DETAILS

Waiting for the wake word costs nothing, since local Whisper does it. Long sounds after the wake word do cost: a room full of talk or music gets transcribed until the conversation times out, 60 seconds after the last thing heard, at $0.0045 a minute.

---

## Languages

English is the default. German and Japanese are built in, each with its own character text, wake word, voice, timezone, weather and memories:

| Language | Set | Wake word | Voice |
| -------- | --- | --------- | ----- |
| English | `LOCALE=en` | "Hey Mira" | Sarah |
| German | `LOCALE=de` | "Hallo Mira" | Matilda |
| Japanese | `LOCALE=ja` | "OK ミラ" | Sarah |

Set `LOCALE` in `.env` and run `docker compose up -d` again, or set `app.locale` in `config/app.yaml` and restart. Each language keeps its own memories, so switching doesn't carry them over. In testing with synthesized voices, local Whisper often misheard the Japanese wake words.

---

## Optional: run more of it yourself

- **Ollama** on a machine with a GPU can take over replies, memory and the camera from OpenAI. Speech output still needs ElevenLabs. See [Getting Started](docs/guide/getting-started.md#optional-ollama-and-local-whisper).
- **Local Whisper after the wake word too**: with `stt.provider: local` in `config/providers.yaml`, nothing you say goes to OpenAI.
- **Whisper on another machine**, for a Raspberry Pi that can't spare the memory. That machine then hears the room, so only use one you trust. See [Services on Another Machine](docs/config/providers.md#services-on-another-machine).

---

## Features

### Voice-First Interaction
Wake it with its name, then talk. Replies are spoken, with a lip-synced avatar.

### Personalized Memory
Automatically extracts and stores information about you from conversations, and brings up related memories in later replies.

### Expressive Avatar
Eight animation states (Idle, Listening, Thinking, Speaking, etc.) show what it's doing at a glance.

### Providers
| Component | Default    | Optional       |
| --------- | ---------- | -------------- |
| LLM       | OpenAI     | Ollama         |
| TTS       | ElevenLabs |                |
| STT       | OpenAI, with local Whisper for the wake word | Local Whisper |
| Embedding | OpenAI     | Ollama         |
| Vision    | OpenAI     | Ollama         |

### Built-in Integrations
- Weather (Open-Meteo)
- Calendar (Google Calendar)
- Web search (Ollama Web Search)
- Reminders
- Discord sharing

### Plugin System
Add your own widgets or sensor integrations. The Vision Companion plugin gives the AI access to your camera, so it can see what you're wearing or holding.

---

## Tech Stack

- **Frontend**: Next.js 15 / React 19 / Three.js
- **Backend**: Node.js / SQLite (Drizzle ORM)
- **AI**: OpenAI / ElevenLabs / speaches (local Whisper) / Ollama (optional)
- **Infra**: Docker Compose

---

## Development

Needs Node 22 and [Bun](https://bun.sh/):

```bash
bun install
bun run dev
```

`config/providers.yaml` expects local Whisper at `http://whisper:8000`, the name it has under Docker Compose, so for `bun run dev` see [Local Development](docs/guide/getting-started.md#local-development).

See [Documentation](https://orangekame3.dev/mirrormate/) for details.

---

## Status

Work in progress. Core features work, but rough edges remain.

If you're into self-hosted systems, voice assistants or physical interfaces, give it a try.

---

## License

[MIT](LICENSE)
