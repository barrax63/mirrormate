# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MirrorMate is a voice-first AI avatar shown behind a half mirror. It is one Next.js 15 App Router app (`output: "standalone"`), typically on a Raspberry Pi, with heavy services (Ollama, VOICEVOX, faster-whisper, PLaMo embedding) optionally on another host. It is effectively single-user: requests fall back to `default-user`, and locale is server-wide. Chrome is required for the Web Speech API.

## Commands

Requires Node 22+ and Bun. CI and Docker install with `bun install --frozen-lockfile`, so `bun.lock` must change along with dependencies.

```bash
bun install
cp .env.example .env
bun run dev                                     # Next.js on port 3000

bun run lint                                    # eslint (ignores plugins/)
bun run build                                   # also the type check; there is no separate script

bun run test                                    # all tests, once
bun run test src/lib/memory/extractor.test.ts   # one file
bun run test -t "test name"                     # by test name
bun run test:watch

bun audit --prod --audit-level=high             # the dependency check CI runs

bun run docs:dev                                # VitePress site in docs/

docker compose up -d                            # app only; set STUDIO_IP in .env
docker compose -f compose.studio.yaml up -d     # VOICEVOX, faster-whisper, PLaMo (Ollama runs natively)
```

Use `bun run test`, not `bun test`: the latter starts Bun's own runner instead of Vitest.

Vitest only collects `src/**/*.test.ts`, runs in the `node` environment, and has no path aliases. Modules under test need relative imports, so the `@/` imports in `tools/see-camera.ts`, `features/calendar/index.ts` and `features/time/index.ts` won't resolve in tests unless an alias is added.

Use `bun audit fix` to patch dependencies, and don't delete entries from `bun.lock` by hand: a frozen install still passes, but packages silently resolve to versions outside their ranges. `package.json` overrides `postcss` because `next` pins a vulnerable exact version; remove the override once `next` no longer does.

## Architecture

### Frontend

- `/` (`src/app/page.tsx`) is the avatar page and the main client orchestrator: mic, wake word, chat calls, audio playback, lip sync, info cards.
- `/control` is a separate operator page, with `/control/memory` and `/control/vision` beneath it. It must run in the same browser as the avatar page because the two talk over `BroadcastChannel("mirror-channel")`.
- `BroadcastMessage` is defined twice, in `src/lib/animation/broadcast-adapter.ts` and `src/app/control/page.tsx`. Update both when adding a message type. `mapBroadcastToEvent` turns messages into events for the avatar's animation state machine in `src/lib/animation/`.
- Both pages call `/api/chat` themselves with `withAudio: false`. Only the avatar page plays replies: it fetches `/api/tts`, and `/control` asks it to with a `play_audio` message. `/control` calls `/api/tts` itself only for voice preview. The `withAudio` branch in the chat route hardcodes OpenAI TTS and ignores `providers.tts`.
- For chat, the hidden `vision-companion` plugin on the avatar page owns the camera. Pages send `camera_capture_request`, receive `camera_capture_response`, and pass the image in the `/api/chat` body. The `see_camera` tool then sends it to the VLM provider.

### `/api/chat` pipeline (`src/app/api/chat/route.ts`)

1. Match the last user message against keyword rules (case-insensitive substring match). A match runs that rule's modules, which can call features and tools.
2. Build the system prompt from the character prompt, RAG memories, and either the rule context or all feature contexts.
3. Run the LLM tool loop, up to 3 iterations. **Tools are disabled and feature contexts are skipped when a rule matched.**
4. Start memory extraction without awaiting it, so failures only appear in logs.

Tool effects (confetti and similar) return through module-level pending state in `src/lib/tools/effects.ts`, not through the tool result.

### Memory

Embeddings are BLOBs in SQLite, searched by brute-force cosine similarity in JS (`searchSimilar` in `src/lib/repositories/memory.ts`). RAG needs both `providers.embedding.enabled` and `providers.memory.enabled`. The only embedding provider is `ollama`; `plamo-server/` works with it by implementing Ollama's `/api/embed`.

### Configuration

Runtime behavior lives in YAML under `config/`, read with `fs` relative to `process.cwd()`. That makes those `src/lib` modules server-only, so client code gets config through API routes such as `/api/wakeword`, `/api/stt/config`, `/api/reminder/config` and `/api/plugins`.

Configs are held in module-level caches. The `clear*Cache` helpers are never called, so **restart the process after editing YAML**. Compose mounts `./config` read-only, so a container restart is enough, without a rebuild.

How the layers resolve:

- **Locale:** `LOCALE` env, then `config/app.yaml`, then `ja` if that file is missing.
- **`config/locales/{ja,en}/`:** `character`, `characters`, `memory`, `modules`, `rules`.
- **`config/presets/{locale}.yaml`:** fills timezone, weather locations, clock and STT language where `features.yaml`, `plugins.yaml` or `providers.yaml` leave them unset.
- **`messages/{locale}.json`:** next-intl UI strings. There is no locale routing.
- **Env overrides:** `LLM_PROVIDER`, `TTS_PROVIDER` and `STT_PROVIDER` change the provider. `APP_CONFIG`, `PROVIDERS_CONFIG`, `FEATURES_CONFIG`, `PLUGINS_CONFIG` and `CHARACTER_CONFIG` select a different file under `config/`.
- **Production:** `features.docker.yaml` and `plugins.docker.yaml` take priority if they exist.

Things that are easy to miss:

- User-facing and prompt text must exist in both `en` and `ja`: the locale YAML, the `messages` files, and inline `getLocale() === "ja"` branches in server code.
- The committed `config/providers.yaml` points at `http://studio:*`, a hostname that only compose's `extra_hosts` defines. Under `bun run dev`, make `studio` resolve or use another config through `PROVIDERS_CONFIG`.
- `compose.yaml` passes an explicit env list that omits `LOCALE` and the `*_PROVIDER` variables, so setting them in `.env` has no effect there. It also needs a valid `STUDIO_IP`, or `docker compose up` fails. `.env.example` defaults to `host-gateway`, which means this machine.
- No API route has authentication, so `compose.yaml` publishes port 3000 on localhost only, unless `BIND_ADDRESS` says otherwise. `compose.studio.yaml` still publishes on all interfaces, because an app on another machine has to reach it.
- `next build` prerenders pages, so UI strings and `<html lang>` use the locale at build time. Changing `LOCALE` or `app.yaml` afterwards only switches the server side (wake word, prompts, database, presets). `next dev` renders per request, which hides this.
- Web Speech always starts in `en-US`: `src/app/page.tsx` passes no `lang` to `useSpeechRecognition`, and `stt.web` in the committed `providers.yaml` parses to null, so the preset never reaches it. The Whisper providers do follow the preset.
- `plamo-server` pins `sentencepiece`, `transformers` and the model revision (`PLAMO_REVISION` in its Dockerfile), because the model's remote code breaks on newer packages. When changing any of them, test `/api/embed` as well as the build: `transformers` 5 builds fine and only fails there.

### Database

Each locale has its own database, `data/mirrormate.{locale}.db`, so memories don't carry across locales. `DATABASE_PATH` overrides this.

Drizzle is used for queries, not migrations. Tables are created by raw SQL when `src/lib/db/index.ts` connects, there is no `drizzle/` directory, and nothing applies generated migrations at runtime. A schema change has to be made in:

1. `src/lib/db/schema.ts`
2. `initializeSchema` in `src/lib/db/index.ts`, for fresh databases
3. `runMigrations` in the same file, for existing databases
4. The hand-written DDL in `src/lib/repositories/memory.test.ts`, if the test tables are affected

`drizzle.config.ts` defaults to `./data/mirrormate.db`, which the app doesn't use. Set `DATABASE_PATH` when running `db:studio` or `db:push`.

### Extension points

- **Plugin:** add an entry in `config/plugins.yaml` and a static import plus map entry in `src/components/PluginRenderer.tsx`, keyed by the manifest `name`. Local plugins live in `plugins/<name>/` with a `manifest.yaml`. GitHub and npm plugins declare their manifest under `mirrormate` in `package.json`, and the Dockerfile needs a `COPY` for that file.
- **LLM tool:** register in the `tools` array in `src/lib/tools/index.ts`.
- **Feature (prompt context):** register in `initializeFeatures` in `src/lib/features/registry.ts` and configure in `config/features.yaml`.
- **Provider:** LLM, STT, VLM and embedding each have `types.ts` and implementations under `src/lib/<kind>/`, with config types in `src/lib/providers/types.ts`. TTS has no abstraction; it is inline in `src/app/api/tts/route.ts`.

The Dockerfile's runner stage contains only the standalone output and explicitly copied paths. Next's file tracing does include local plugin manifests, so `plugins/<name>/manifest.yaml` needs no `COPY`. Native modules and runtime files it can't trace need their own `COPY` line.

## Workflow

- PRs target `develop`. Commits follow Conventional Commits, and the prefixes drive PR labels.
- CI runs lint, test, build and a production dependency audit on PRs into `develop` and pushes to it, but only when `src/**`, `config/**`, `plugins/**`, `messages/**`, `package.json`, `bun.lock`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `Dockerfile` or the CI workflow change. Changes confined to `docs/` don't trigger it.
- Pushes to `develop` deploy `docs/**` changes to GitHub Pages. `vX.Y.Z` tags publish multi-arch images to GHCR.
