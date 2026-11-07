# Docker Setup

`compose.yaml` runs Mirror Mate and local Whisper on one machine, such as a Raspberry Pi. Everything else goes to OpenAI and ElevenLabs, unless you point it at Ollama.

## Architecture

Local Whisper runs next to the app, because it hears everything said in the room while the app waits for the wake word:

```mermaid
flowchart TB
    subgraph Host["Raspberry Pi (or any machine)"]
        subgraph MM["mirrormate :3000"]
            App["Next.js App"]
            SQLite[(SQLite<br/>Memory)]
        end
        Whisper["whisper (speaches)<br/>no published port"]
        Volume[("mirrormate-data<br/>volume")] -.-> SQLite
    end

    MM -->|"http://whisper:8000<br/>before the wake word"| Whisper
    MM -->|"HTTPS<br/>replies, memory, vision,<br/>speech after the wake word"| OpenAI["OpenAI (cloud)"]
    MM -->|HTTPS| ElevenLabs["ElevenLabs (cloud)<br/>speech"]
    MM -.->|"optional, by IP address"| Ollama["Ollama<br/>(another machine)"]
```

## Quick Start

1. **Get the code and create the environment file**

```bash
git clone https://github.com/barrax63/mirrormate.git
cd mirrormate
cp .env.example .env
# Set OPENAI_API_KEY and ELEVENLABS_API_KEY
```

2. **Start the app and Whisper**

```bash
docker compose up -d
```

This downloads the app's image, `ghcr.io/barrax63/mirrormate`, for amd64 or arm64. The first start also downloads the Whisper model, about half a gigabyte, into the `whisper-models` volume. The app only starts once Whisper answers on `/health`, so this takes a few minutes. `docker compose ps` shows both running when it's done.

3. **Access**

Open http://localhost:3000 in Chrome or Brave on the same machine, allow the microphone, click the page once so it may play sound, and say "Hey Mira". See [Getting Started](/guide/getting-started#quick-start).

## Ollama or Whisper on Another Machine

Ollama is optional, and Whisper can run on another machine too, such as when a Raspberry Pi can't spare the memory. `config/providers.yaml` reaches both by the IP address of the machine they run on, such as its Tailscale IP (`tailscale ip -4`). Inside the container, `localhost` is the container itself, so use the IP address even if that's this machine. See [Services on Another Machine](/config/providers#services-on-another-machine) for the settings.

With Whisper on another machine, start only the app, or `compose.yaml` starts its own Whisper as well:

```bash
docker compose up -d --no-deps mirrormate
```

## Compose File

```yaml
services:
  mirrormate:
    image: ghcr.io/barrax63/mirrormate:0.2.0
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "${BIND_ADDRESS:-127.0.0.1}:3000:3000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ELEVENLABS_API_KEY=${ELEVENLABS_API_KEY}
      - LOCALE=${LOCALE:-}
      - LLM_PROVIDER=${LLM_PROVIDER:-}
      - STT_PROVIDER=${STT_PROVIDER:-}
      - GOOGLE_SERVICE_ACCOUNT_EMAIL=${GOOGLE_SERVICE_ACCOUNT_EMAIL:-}
      - GOOGLE_PRIVATE_KEY=${GOOGLE_PRIVATE_KEY:-}
      - GOOGLE_CALENDAR_ID=${GOOGLE_CALENDAR_ID:-}
      - OLLAMA_API_KEY=${OLLAMA_API_KEY:-}
      - DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL:-}
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

Compose downloads the app's image of the version that `compose.yaml` names, and builds it from the checkout only with `--build`, or when the download fails. Whisper's image is pinned to a digest, so it can't change under you. `speaches` answers `model: small` with a 404, so `stt.local.model` needs the full ID. Inside the app's container, `whisper` in `config/providers.yaml` resolves to the Whisper container.

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

The Whisper container publishes no port, so only the app can reach it. Ollama with `OLLAMA_HOST=0.0.0.0`, and Whisper published on another machine, take no key from Mirror Mate either, so anything that reaches their ports can use them, and that Whisper hears the room. Keep those machines on a trusted network, such as Tailscale, or restrict those ports with a firewall.

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
# Required: OpenAI, for replies, speech after the wake word, memory and the camera.
# Set a hard spend limit on its project, as .env.example describes.
OPENAI_API_KEY=sk-...

# Required: ElevenLabs, for speech output. .env.example describes opting out of
# model training.
ELEVENLABS_API_KEY=...

# Optional: the language, en, de or ja, in place of config/app.yaml's
LOCALE=en

# Optional: llm.provider and stt.provider in place of config/providers.yaml's
LLM_PROVIDER=openai
STT_PROVIDER=openai

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

`compose.yaml` passes only these to the app. After changing `.env`, run `docker compose up -d`, which recreates the app with the new values. `docker compose restart` keeps the old ones.

## Whisper Performance

`compose.yaml` runs Whisper on the CPU. On the x86 machine it was tested on, `small` took about 1.2 s per recording on 16 cores and 4.4 s on one, and used up to 2.6 GB of memory. It hasn't been measured on a Raspberry Pi, and a 2 GB Pi doesn't have the memory. On a machine that can't spare it, run [Whisper on another machine](#ollama-or-whisper-on-another-machine) you trust with the room's audio, or use `Systran/faster-whisper-base`, which recognized the wake word less reliably in testing.

`speaches` also publishes CUDA images, which haven't been tried with Mirror Mate.

## Troubleshooting

### No reply, or a reply that isn't spoken

Both pages say why a request failed, such as "Speech: ElevenLabs is out of credit." or "Replies: OpenAI rejected the API key." See [When something fails](/config/providers#when-something-fails) for what each message means. After fixing a key in `.env`, run `docker compose up -d`, which recreates the app with it.

### Cannot connect to Ollama

**Error**: Connection refused, or a timeout, for Ollama's `baseUrl` in the app's log

**Solution**:
1. Ensure Ollama is running on its machine: `curl http://localhost:11434/api/tags` there
2. Check it listens beyond localhost: start it with `OLLAMA_HOST=0.0.0.0`
3. Check this machine reaches it: `curl http://100.x.x.x:11434/api/tags`, with that machine's IP address
4. Check `baseUrl` uses that IP address, not `localhost`, and restart the app after changing it

### Config changes not applied

**Solution**: Config is mounted as read-only and cached when first loaded, so restart the container after editing it: `docker compose restart mirrormate`. No rebuild is needed.

### Wake word not recognized

**Error**: The avatar never wakes, and says "Wake word: Local Whisper can't be reached." or "Local Whisper returned an error."

While local Whisper is down, the wake word stops working. Nothing heard is sent to `stt.provider` instead.

**Solution**:
1. Check the Whisper container: `docker compose ps whisper`
2. Check logs: `docker compose logs whisper`
3. A 404 in the app's log means `stt.local.model` isn't a full model ID such as `Systran/faster-whisper-small`
4. With Whisper on another machine, check `stt.local.baseUrl`, and that `curl http://100.x.x.x:8000/health` answers from this machine

### No audio on Raspberry Pi

Replies play from the device running the browser.

**Solution**:
1. Check audio output: `aplay -l`
2. Set correct output: `raspi-config` → Audio
3. Test: `speaker-test -t wav`

## Commands

```bash
# Start the app and Whisper
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down

# Update to the latest version
git pull
docker compose up -d

# Build the image from this checkout, such as after changing the code
docker compose up -d --build

# Build it from scratch
docker compose build --no-cache
docker compose up -d
```

The logs don't hold what's said, heard or seen. Transcripts, replies and camera descriptions show up only as their length.
