# Docker Setup

Mirror Mate can be deployed using Docker with a recommended split architecture.

## Recommended Architecture

Run heavy services on a powerful server (e.g., Mac Studio) and the UI on a lightweight device (e.g., Raspberry Pi), connected via Tailscale. Local Whisper runs next to the app, because it hears everything said in the room while the app waits for the wake word:

```mermaid
flowchart TB
    subgraph Tailscale["Tailscale Network"]
        subgraph Studio["Mac Studio (studio)"]
            Ollama["Ollama (native)<br/>:11434"]
            PLaMo["PLaMo-Embedding (Docker)<br/>:8000"]
        end

        subgraph RPi["Raspberry Pi"]
            subgraph MM["mirrormate :3000"]
                App["Next.js App"]
                SQLite[(SQLite<br/>Memory)]
            end
            Whisper["whisper (speaches)<br/>no published port"]
            Volume[("mirrormate-data<br/>volume")] -.-> SQLite
        end

        MM -->|http://studio:11434| Ollama
        MM -->|http://studio:8000| PLaMo
        MM -->|"http://whisper:8000<br/>before the wake word"| Whisper
    end

    MM -->|HTTPS| ElevenLabs["ElevenLabs (cloud)<br/>speech"]
    MM -->|"HTTPS<br/>after the wake word"| OpenAI["OpenAI (cloud)<br/>speech recognition"]
```

## Quick Start

### Mac Studio Setup

1. **Install Ollama (native)**

```bash
brew install ollama
brew services start ollama
ollama pull gpt-oss:20b
```

2. **Start Docker Services**

```bash
docker compose -f compose.studio.yaml up -d
```

This starts:
- **PLaMo-Embedding-1B** (:8000) - Japanese-optimized embedding

3. **Verify**

```bash
curl http://localhost:11434/api/tags    # Ollama
curl http://localhost:8000/health       # PLaMo
```

### Raspberry Pi Setup

1. **Create Environment File**

```bash
cp .env.example .env
# Set STUDIO_IP to the Mac Studio's Tailscale IP (tailscale ip -4) and add your API keys
```

2. **Configure providers.yaml**

Ensure `config/providers.yaml` points to your Mac Studio:

```yaml
providers:
  llm:
    provider: ollama
    ollama:
      baseUrl: "http://studio:11434"  # Tailscale hostname

  tts:
    provider: elevenlabs  # Needs ELEVENLABS_API_KEY in .env

  stt:
    provider: openai  # What's said after the wake word. Needs OPENAI_API_KEY in .env
    wakeWord:
      provider: local  # Everything heard before it, which stays on this machine
    local:
      baseUrl: "http://whisper:8000"  # The whisper service in compose.yaml
      model: Systran/faster-whisper-small

  embedding:
    provider: ollama
    ollama:
      baseUrl: "http://studio:8000"  # PLaMo server
```

Inside the container, `studio` resolves to `STUDIO_IP` through `extra_hosts` in `compose.yaml`, and `whisper` to the Whisper container.

3. **Start the app and Whisper**

```bash
docker compose up -d
```

The first start downloads the Whisper model, about half a gigabyte, into the `whisper-models` volume. The app only starts once Whisper answers on `/health`, so this takes a minute or more.

4. **Access**

Open http://localhost:3000

## Compose Files

### compose.yaml (App and Whisper - Raspberry Pi)

```yaml
services:
  mirrormate:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "${BIND_ADDRESS:-127.0.0.1}:3000:3000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ELEVENLABS_API_KEY=${ELEVENLABS_API_KEY}
      - GOOGLE_SERVICE_ACCOUNT_EMAIL=${GOOGLE_SERVICE_ACCOUNT_EMAIL}
      - GOOGLE_PRIVATE_KEY=${GOOGLE_PRIVATE_KEY}
      - GOOGLE_CALENDAR_ID=${GOOGLE_CALENDAR_ID}
      - OLLAMA_API_KEY=${OLLAMA_API_KEY}
      - DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL}
    extra_hosts:
      - "studio:${STUDIO_IP}"
    volumes:
      - ./config:/app/config:ro
      - mirrormate-data:/app/data
    depends_on:
      whisper:
        condition: service_healthy
    restart: unless-stopped

  whisper:
    image: ghcr.io/speaches-ai/speaches:0.9.0-rc.3-cpu@sha256:2163775b6df5e451a71200e8f675fed68dbd8ab184fc604453d549e486f22fd2
    environment:
      - 'PRELOAD_MODELS=["Systran/faster-whisper-small"]'
      - ENABLE_UI=false
      - WHISPER__INFERENCE_DEVICE=cpu
      - STT_MODEL_TTL=-1  # keeps the model loaded
    volumes:
      - whisper-models:/home/ubuntu/.cache/huggingface/hub
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8000/health"]
      # ...
    restart: unless-stopped

volumes:
  mirrormate-data:
  whisper-models:
```

The image is pinned to a digest, so it can't change under you. `speaches` answers `model: small` with a 404, so `stt.local.model` needs the full ID.

### compose.studio.yaml (Services - Mac Studio)

```yaml
services:
  # Embedding
  plamo-embedding:
    build:
      context: ./plamo-server
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    restart: unless-stopped
```

## Network Access

::: warning
The app has no authentication. Anything that can reach port 3000 can read and delete your memories and use your LLM and other services.
:::

`compose.yaml` therefore publishes port 3000 on localhost only. To open it to other devices, set `BIND_ADDRESS` in `.env` to an address on a private network, then run `docker compose up -d`:

```bash
BIND_ADDRESS=100.x.x.x  # for example, this machine's Tailscale IP (tailscale ip -4)
```

- Docker can only bind an address that exists when the container starts, so Tailscale must be up first.
- Browsers only allow the mic and camera on localhost or HTTPS, so the avatar page needs one of those for voice and vision.
- `/control` must run in the same browser as the avatar page, so another device can only use it for pages that don't need the avatar, such as `/control/memory`.

The Whisper container publishes no port, so only the app can reach it. `compose.studio.yaml` publishes PLaMo on all interfaces, also without authentication, because an app on another machine has to reach it. Ollama with `OLLAMA_HOST=0.0.0.0` is the same. Keep that machine on a trusted network, such as Tailscale, or restrict those ports with a firewall.

## Data Persistence

The SQLite database (memories, users, sessions) is stored in the `mirrormate-data` Docker volume. Compose prefixes the volume with the project name, which defaults to the directory name, so it is usually `mirrormate_mirrormate-data`. Each locale has its own database file, `mirrormate.[lang].db`.

These commands use the English database. SQLite runs in WAL mode, so stop the app first and copy the `-wal` and `-shm` files along with the database:

```bash
# View volume location
docker volume inspect mirrormate_mirrormate-data

# Backup the database
docker compose stop mirrormate
docker run --rm -v mirrormate_mirrormate-data:/data -v "$(pwd)":/backup alpine \
  sh -c 'cp /data/mirrormate.en.db* /backup/'
docker compose start mirrormate

# Restore from backup (the app runs as UID 1001)
docker compose stop mirrormate
docker run --rm -v mirrormate_mirrormate-data:/data -v "$(pwd)":/backup alpine \
  sh -c 'rm -f /data/mirrormate.en.db*; cp /backup/mirrormate.en.db* /data/ && chown 1001 /data/mirrormate.en.db*'
docker compose start mirrormate
```

## Environment Variables

Create a `.env` file:

```bash
# Required by compose.yaml: Tailscale IP of the machine running the heavy services,
# or host-gateway if they run on this machine
STUDIO_IP=100.x.x.x

# Required for the OpenAI LLM and speech recognition (if not using Ollama)
OPENAI_API_KEY=sk-...

# Required for ElevenLabs speech output
ELEVENLABS_API_KEY=...

# Optional: Google Calendar
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_CALENDAR_ID=...

# Optional: Web Search (Ollama)
# Get API key from: https://ollama.com/settings/keys
OLLAMA_API_KEY=your-ollama-api-key

# Optional: Discord Integration
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

## GPU Support

### Whisper

`compose.yaml` runs Whisper on the CPU. On the x86 machine it was tested on, `small` took about 1.2 s per recording on 16 cores and 4.4 s on one, and used up to 2.6 GB of memory. It hasn't been measured on a Raspberry Pi, and a 2 GB Pi doesn't have the memory. On a machine that can't spare it, point `stt.local.baseUrl` at Whisper on another machine you trust with the room's audio, or use `Systran/faster-whisper-base`, which recognized the wake word less reliably in testing.

`speaches` also publishes CUDA images, which haven't been tried with Mirror Mate.

### Apple Silicon (Mac Studio)

Note: Metal GPU acceleration is not available in Docker containers.

## Troubleshooting

### Cannot connect to Ollama

**Error**: Connection refused to `studio:11434`

**Solution**:
1. Ensure Ollama is running on Mac Studio: `ollama serve` or `brew services start ollama`
2. Verify Tailscale connection: `ping studio`
3. Check Ollama is listening: `curl http://studio:11434/api/tags`
4. Check `STUDIO_IP` in `.env`, and that Ollama listens on more than localhost (`OLLAMA_HOST=0.0.0.0`)

### Config changes not applied

**Solution**: Config is mounted as read-only and cached when first loaded, so restart the container after editing it: `docker compose restart mirrormate`. No rebuild is needed.

### Wake word not recognized

**Error**: The avatar never wakes, and says "Wake word: Local Whisper can't be reached." or "Local Whisper returned an error."

While local Whisper is down, the wake word stops working. Nothing heard is sent to `stt.provider` instead.

**Solution**:
1. Check the Whisper container: `docker compose ps whisper`
2. Check logs: `docker compose logs whisper`
3. A 404 in the app's log means `stt.local.model` isn't a full model ID such as `Systran/faster-whisper-small`

## Commands

### Mac Studio

```bash
# Start PLaMo Embedding
docker compose -f compose.studio.yaml up -d

# View logs
docker compose -f compose.studio.yaml logs -f

# Stop
docker compose -f compose.studio.yaml down
```

### Raspberry Pi

```bash
# Start the app and Whisper
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down

# Rebuild after code changes
docker compose build --no-cache
docker compose up -d
```
