<p align="center">
  <img src="docs/public/mirrormate.png" alt="MirrorMate" width="400">
</p>

<h1 align="center">MirrorMate</h1>

<p align="center">
  <strong>Self-hosted personalized AI in a mirror</strong>
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

- A voice-first AI designed to live in a mirror
- Buildable with Raspberry Pi + half mirror
- Remembers you through RAG-based memory

## What it is not

- Not a smart display
- Not another chat UI in a browser

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Raspberry Pi                             │
│  ┌───────────────┐  ┌────────────┐  ┌────────────────────────┐  │
│  │  Browser      │  │  Next.js   │  │  SQLite                │  │
│  │  (Chromium)   │◄─┤  App       │◄─┤  (Memory, Sessions)    │  │
│  │  + Mic/Cam    │  │  Port 3000 │  │                        │  │
│  └───────────────┘  └─────┬──────┘  └────────────────────────┘  │
│         ▲                 │         ┌────────────────────────┐  │
│         │                 ├────────►│  Whisper (wake word)   │  │
│         │                 │         └────────────────────────┘  │
│         │                 │ Tailscale VPN                       │
└─────────┼─────────────────┼─────────────────────────────────────┘
          │                 ▼
          │   ┌─────────────────────────────────────────────────┐
          │   │                  Mac Studio                     │
          │   │  ┌────────────┐ ┌──────────────┐                │
          │   │  │  Ollama    │ │  PLaMo       │                │
          │   │  │  LLM/VLM   │ │  Embedding   │                │
          │   │  │  Port 11434│ │  Port 8000   │                │
          │   │  └────────────┘ └──────────────┘                │
          │   └─────────────────────────────────────────────────┘
          │
          └── Half Mirror + Monitor
```

**Minimal setup**: Raspberry Pi + OpenAI and ElevenLabs API keys

**With a local server**: Combine with Mac Studio (or any GPU machine) as shown above. Speech output still comes from ElevenLabs.

---

## Quick Start

**With OpenAI and ElevenLabs (the default):**

```bash
git clone https://github.com/barrax63/mirrormate.git
cd mirrormate
cp .env.example .env    # set OPENAI_API_KEY and ELEVENLABS_API_KEY
docker compose up -d
```

This starts the app and local Whisper, which listens for the wake word. Open http://localhost:3000 in Chrome or Brave. `.env.example` also recommends a spend limit on the OpenAI project and opting out of model training in ElevenLabs.

**Wake word**: Say "Hey Mira" to activate.

---

## Features

### Voice-First Interaction
Activate with a wake word. Local Whisper listens for it, so nothing said in the room before it leaves your machine. What's said after it goes to OpenAI, or to local Whisper too.

### Personalized Memory
Automatically extracts and stores information about you from conversations. Uses RAG to retrieve relevant memories and generate personalized responses.

### Expressive Avatar
Lip-synced avatar speaks responses. Eight animation states (Idle, Listening, Thinking, Speaking, etc.) show what it's doing at a glance.

### Multi-Provider Support
| Component | Options                                       |
| --------- | --------------------------------------------- |
| LLM       | OpenAI, Ollama                                |
| TTS       | ElevenLabs                                    |
| STT       | OpenAI, Local Whisper                         |
| Embedding | Ollama, PLaMo-Embedding-1B                    |

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
- **AI**: Ollama / OpenAI / ElevenLabs / faster-whisper
- **Infra**: Docker / Tailscale

---

## Development

```bash
bun install
bun run dev
```

See [Documentation](https://orangekame3.dev/mirrormate/) for details.

---

## Status

Work in progress. Core features work, but rough edges remain.

If you're into local AI, self-hosted systems, or physical interfaces, give it a try.

---

## License

[MIT](LICENSE)
