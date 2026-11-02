# Recommended Setup

This guide describes the recommended production setup for Mirror Mate using Tailscale to connect a Raspberry Pi display with a Mac Studio backend.

## Architecture Overview

```mermaid
flowchart TB
    subgraph Tailscale["Tailscale Network"]
        subgraph Studio["Mac Studio (studio)"]
            Ollama["Ollama (native)<br/>LLM<br/>:11434"]
            PLaMo["PLaMo (Docker)<br/>Embedding<br/>:8000"]
        end

        subgraph RPi["Raspberry Pi"]
            Mirror["Mirror Display"]
            subgraph App["mirrormate :3000"]
                NextJS["Next.js App"]
                SQLite[(SQLite)]
            end
            Speaker["Speaker"]
        end

        subgraph MacBook["MacBook (Development)"]
            Dev["bun run dev<br/>:3000"]
        end

        App -->|LLM| Ollama
        App -->|Embedding| PLaMo
        Dev -->|LLM| Ollama
        Dev -->|Embedding| PLaMo
        App --> Mirror
        App -->|Audio| Speaker
    end

    ElevenLabs["ElevenLabs (cloud)<br/>TTS"]
    App -->|TTS| ElevenLabs
    Dev -->|TTS| ElevenLabs
```

## Why This Setup?

| Component | Location | Reason |
|-----------|----------|--------|
| **Ollama** | Mac Studio (native) | Metal GPU acceleration for fast LLM inference |
| **PLaMo-Embedding-1B** | Mac Studio (Docker) | Japanese-optimized embedding, top JMTEB scores |
| **ElevenLabs** | Cloud | Speech output, one voice for every language |
| **UI** | Raspberry Pi | Low power, silent, dedicated display |
| **Development** | MacBook | Same config as production, no local services needed |

## Prerequisites

- Mac Studio (Apple Silicon recommended)
- Raspberry Pi 4/5 with display
- MacBook for development
- [Tailscale](https://tailscale.com/) account (free tier is sufficient)

## Step 1: Tailscale Setup

Install Tailscale on all devices:

### Mac Studio / MacBook

```bash
brew install tailscale
```

Open Tailscale from Applications and sign in.

### Raspberry Pi

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

### Verify Connection

After all devices are connected, verify they can reach each other:

```bash
# From MacBook or RPi
ping studio    # Mac Studio's Tailscale hostname
```

You can find/set hostnames in the [Tailscale admin console](https://login.tailscale.com/admin/machines).

## Step 2: Mac Studio Setup

### Install Ollama (Native)

```bash
# Install
brew install ollama

# Start as service
brew services start ollama

# Pull LLM model
ollama pull gpt-oss:20b
```

### Start Docker Services (PLaMo)

First, install Docker via [OrbStack](https://orbstack.dev/) (recommended for Apple Silicon):

```bash
brew install orbstack
open -a OrbStack
```

Then start services:

```bash
cd /path/to/mirrormate
docker compose -f compose.studio.yaml up -d
```

This starts:
- **PLaMo-Embedding-1B** (:8000) - Japanese-optimized text embedding

Local Whisper runs next to the app, from `compose.yaml`.

### Verify Services

```bash
# Ollama (LLM)
curl http://localhost:11434/api/tags

# PLaMo (Embedding)
curl http://localhost:8000/health
```

## Step 3: Configuration

Create or edit `config/providers.yaml`:

```yaml
providers:
  llm:
    enabled: true
    provider: ollama
    ollama:
      model: gpt-oss:20b
      baseUrl: "http://studio:11434"  # Tailscale hostname
      maxTokens: 300
      temperature: 0.7

  tts:
    enabled: true
    provider: elevenlabs  # Needs ELEVENLABS_API_KEY in .env

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

Under `bun run dev`, `studio` resolves through Tailscale. Inside the container, it resolves to `STUDIO_IP` through `extra_hosts` in `compose.yaml`.

## Step 4: Web Search Setup (Optional)

To enable web search functionality:

1. Get an API key from [Ollama](https://ollama.com/settings/keys)
2. Add to `.env` on the Raspberry Pi:

```bash
OLLAMA_API_KEY=your-ollama-api-key-here
```

## Step 5: Raspberry Pi Setup

### Clone Repository

```bash
git clone https://github.com/orangekame3/mirrormate.git
cd mirrormate
```

### Create Environment File

```bash
cp .env.example .env
# Set STUDIO_IP to the Mac Studio's Tailscale IP (tailscale ip -4),
# ELEVENLABS_API_KEY for speech, and API keys for optional services
```

### Start Application

```bash
docker compose up -d
```

### Auto-start on Boot (Optional)

```bash
# Add to /etc/rc.local or create systemd service
cd /home/pi/mirrormate && docker compose up -d
```

### Access

Open http://localhost:3000 on the RPi's browser.

Port 3000 is only published on localhost, because the app has no authentication. To open it from another device, set `BIND_ADDRESS` in `.env` to the RPi's Tailscale IP (`tailscale ip -4`), then run `docker compose up -d`. See [Network Access](docker.md#network-access).

## Step 6: Development (MacBook)

With this setup, development requires no local services:

```bash
cd mirrormate
bun install
bun run dev
```

The app connects to Mac Studio for all heavy processing via Tailscale.

## Audio Flow

```mermaid
sequenceDiagram
    participant Browser as Browser (RPi)
    participant API as Next.js API
    participant EL as ElevenLabs (cloud)
    participant Speaker as Speaker (RPi)

    Browser->>API: Text to speak
    API->>EL: POST /v1/text-to-speech/{voice_id}
    EL-->>API: MP3 audio
    API-->>Browser: Audio response
    Browser->>Speaker: Play audio
```

The audio plays from the device running the browser (RPi).

Ensure your RPi has speakers connected and audio output configured:

```bash
# Test audio on RPi
aplay /usr/share/sounds/alsa/Front_Center.wav
```

## File Structure

```mermaid
graph LR
    subgraph Repository
        compose["compose.yaml<br/>(RPi UI)"]
        studio["compose.studio.yaml<br/>(Mac Studio services)"]
        subgraph config["config/"]
            providers["providers.yaml<br/>(shared config)"]
        end
        subgraph data["data/"]
            db["mirrormate.ja.db<br/>(per device)"]
        end
    end
```

## Commands Reference

### Mac Studio

```bash
# Start services (PLaMo)
docker compose -f compose.studio.yaml up -d

# Stop services
docker compose -f compose.studio.yaml down

# View logs
docker compose -f compose.studio.yaml logs -f

# View PLaMo logs
docker compose -f compose.studio.yaml logs -f plamo-embedding

# Rebuild PLaMo after updates
docker compose -f compose.studio.yaml build plamo-embedding

# Restart Ollama
brew services restart ollama
```

### Raspberry Pi

```bash
# Start UI
docker compose up -d

# Stop UI
docker compose down

# View logs
docker compose logs -f

# Rebuild after updates
git pull
docker compose build --no-cache
docker compose up -d
```

### Development (MacBook)

```bash
# Start dev server
bun run dev

# Build
bun run build

# Test
bun run test
```

## Troubleshooting

### Cannot connect to studio

**Error**: Connection refused to `studio:11434`

**Solution**:
1. Verify Tailscale is running: `tailscale status`
2. Check hostname: `ping studio`
3. Ensure Ollama is running: `brew services list | grep ollama`

### No speech

**Error**: `ElevenLabs returned 401` in the app's log

**Solution**:
1. Check `ELEVENLABS_API_KEY` in `.env`, and that the key has the Text to Speech permission
2. The status in brackets says why: `invalid_api_key`, `missing_permissions`, or `quota_exceeded` when the account is out of credits

### No audio on RPi

**Solution**:
1. Check audio output: `aplay -l`
2. Set correct output: `raspi-config` → Audio
3. Test: `speaker-test -t wav`

### Memory not shared between devices

This is expected. Each device has its own SQLite database, with one file per locale. On the RPi it lives in a Docker volume, so copy the file over and then restore it as described in [Data Persistence](docker.md#data-persistence):

```bash
# From MacBook to RPi
scp data/mirrormate.ja.db pi@rpi:~/mirrormate/
```

## Next Steps

- [Docker Setup](docker.md) - Detailed Docker configuration
- [Locale Presets](../config/presets.md) - Configure timezone, weather, and STT by locale
- [Providers Configuration](../config/providers.md) - LLM/TTS provider options
- [Memory System](memory.md) - RAG and memory management
