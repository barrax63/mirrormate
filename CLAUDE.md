# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MirrorMate is a voice-first AI avatar shown behind a half mirror. It is one Next.js 15 App Router app (`output: "standalone"`), typically on a Raspberry Pi, with local Whisper (`speaches`) next to it for the wake word, ElevenLabs for speech output, and OpenAI for everything else, or optionally Ollama on another host. It is effectively single-user: requests fall back to `default-user`, and locale is server-wide.

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

bunx playwright install chromium                # once, before the first e2e run
bun run test:e2e                                # builds with LOCALE=en, then runs Playwright
bunx playwright test e2e/control.spec.ts        # one file, against the existing build

bun audit --prod --audit-level=high             # the dependency check CI runs

bun run docs:dev                                # VitePress site in docs/

docker compose up -d                            # published app image and local Whisper; needs both keys in .env
docker compose up -d --build                    # the same, with the app built from this checkout
```

Use `bun run test`, not `bun test`: the latter starts Bun's own runner instead of Vitest.

Vitest only collects `src/**/*.test.ts` and runs in the `node` environment.

Playwright runs `e2e/*.spec.ts` against the production build. `playwright.config.ts` starts `e2e/mock-backends.mjs` (fake OpenAI, ElevenLabs and local Whisper, which has its own path; the Ollama providers have no e2e coverage) and `next start` three times: `en` on port 3100, `ja` on 3101 and `de` on 3102, built in English so the other two show what `LOCALE` changes at runtime. Both use `e2e/config/*.yaml` and throwaway databases in `e2e/.tmp/`. Chromium gets a fake camera and `e2e/fake-mic.js`, a WebAudio tone in place of the microphone. It ends each recording with the words said during it, which the mock returns as the transcript. So `avatar.hear(text)` runs the real recorder, silence detection and `/api/stt`, and a word that a recording cut off is missing from its transcript. `OPENAI_BASE_URL`, `tts.elevenlabs.baseUrl` and dummy keys keep every OpenAI and ElevenLabs call on the mock, even with real keys in `.env`. Real microphones and speech recognition aren't covered.

Known bugs are covered by expected failures: `it.fails` in Vitest, and `test.fail()` in tests named `known bug: ...` in Playwright. `test.fail()` is called right before the failing assertion, so broken setup still fails the test. A fix makes its test fail with "Expected to fail, but passed", so remove the marker in the same change. Playwright's list output prints ✘ for expected failures, but counts them as passed.

Use `bun audit fix` to patch dependencies, and don't delete entries from `bun.lock` by hand: a frozen install still passes, but packages silently resolve to versions outside their ranges. `package.json` overrides `postcss` because `next` pins a vulnerable exact version; remove the override once `next` no longer does.

## Architecture

### Frontend

- `/` (`src/app/page.tsx`) is the avatar page and the main client orchestrator: mic, wake word, chat calls, audio playback, lip sync, info cards.
- `/control` is a separate operator page, with `/control/memory` and `/control/vision` beneath it. It must run in the same browser as the avatar page because the two talk over `BroadcastChannel("mirror-channel")`.
- `BroadcastMessage` in `src/lib/broadcast.ts` lists every message type, and each sender checks its message with `satisfies BroadcastMessage`. Add a new type there. `mapBroadcastToEvent` in `src/lib/animation/broadcast-adapter.ts` turns the mic and thinking messages into events for the avatar's animation state machine.
- Both pages call `/api/chat` themselves. Only the avatar page plays replies: it fetches `/api/tts`, and `/control` asks it to with a `play_audio` message. `/control` calls `/api/tts` itself only for voice preview.
- Info cards come only from tools (`infoCard` in a tool's result, returned as `infoCards`) and reminders, never from reading the reply text. `/control` forwards its replies' cards to the avatar page as `info_cards`.
- The avatar page keeps one `BroadcastChannel` and one `AudioContext` for its whole life, and its channel handler reads current state through a ref. Don't tie either to state: recognition stops during every reply, so closing the `AudioContext` on a state change cuts the reply off.
- The avatar page records nothing until `/api/stt/config` has loaded, and if that fails, both pages show the error. Everything recorded while waiting for the wake word, or before its config has loaded, goes to `/api/stt` with `purpose: wakeWord`, which only local Whisper transcribes, with no fallback. A recording counts if the page was waiting at any point during it. While waiting, `useAudioRecorder` cuts recordings `stt.wakeWord.maxRecordingDuration` after their sound starts, with the next one starting `overlap` earlier on the same mic. When the wake word is heard, recordings that started before its recording ended are dropped, and their transcripts ignored.
- For chat, the hidden `vision-companion` plugin on the avatar page owns the camera. Pages send `camera_capture_request`, receive `camera_capture_response`, and pass the image in the `/api/chat` body. The `see_camera` tool then sends it to the VLM provider. The Vision toggle on `/control` is `user_settings.vision_enabled`, read and changed through `useVisionEnabled`, which shares changes as `vision_toggle`. While it's off, or not yet loaded, the plugin keeps the camera closed and the pages capture nothing, and `/api/chat` drops any image it's sent.

### `/api/chat` pipeline (`src/app/api/chat/route.ts`)

1. Keep only the last `providers.llm.historyLimit` messages (20 by default), starting at a user message (`src/lib/chat/history.ts`). The reply returns `historyLimit`, and both pages trim what they keep with it.
2. Match the last user message against keyword rules (case-insensitive substring match). A match runs that rule's modules, which can call features and tools.
3. Build the system prompt from the character prompt, RAG memories, and either the rule context or all feature contexts.
4. Run the LLM tool loop, up to 3 iterations. **Tools are disabled when a rule matched, and feature contexts are skipped.** The exception: if the rule's modules return nothing, its response hint is dropped and feature contexts are used, still without tools.
5. If that ends without reply text, such as with tools still being called at the limit, ask once more without tools. If that's empty too, reply with `character.fallbackReply` from the locale's `character.yaml`, and skip memory extraction.
6. Start memory extraction without awaiting it, so failures only appear in logs.

Tool effects (confetti and similar) return through module-level pending state in `src/lib/tools/effects.ts`, not through the tool result.

### Memory

Embeddings are BLOBs in SQLite, searched by brute-force cosine similarity in JS (`searchSimilar` in `src/lib/repositories/memory.ts`). RAG needs both `providers.embedding.enabled` and `providers.memory.enabled`. The embedding providers are `openai` and `ollama`. Each vector is stored with its model's name, `searchSimilar` only compares vectors from the query's model, and `RAGService` first embeds any memory that has no vector from the current model, so changing the embedding model re-embeds everything on the next chat request.

### Configuration

Runtime behavior lives in YAML under `config/`, read with `fs` relative to `process.cwd()`. That makes those `src/lib` modules server-only, so client code gets config through API routes such as `/api/wakeword`, `/api/stt/config`, `/api/reminder/config` and `/api/plugins`.

Configs are held in module-level caches. The `clear*Cache` helpers are never called, so **restart the process after editing YAML**. Compose mounts `./config` read-only, so a container restart is enough, without a rebuild.

How the layers resolve:

- **Locale:** `LOCALE` env, then `config/app.yaml`, then `ja` if that file is missing or names a locale that `LOCALES` in `src/lib/app/index.ts` doesn't list.
- **`config/locales/{en,ja,de}/`:** `character`, `characters`, `memory`, `modules`, `rules`.
- **`config/presets/{locale}.yaml`:** fills timezone, weather locations, clock, STT language and the ElevenLabs voice where `features.yaml`, `plugins.yaml` or `providers.yaml` leave them unset. The voice picked on `/control` beats both.
- **`messages/{locale}.json`:** next-intl UI strings. There is no locale routing.
- **Env overrides:** `LLM_PROVIDER` and `STT_PROVIDER` change the provider. `APP_CONFIG`, `PROVIDERS_CONFIG`, `FEATURES_CONFIG`, `PLUGINS_CONFIG` and `CHARACTER_CONFIG` select a different file under `config/`.
- **Production:** `features.docker.yaml` and `plugins.docker.yaml` take priority if they exist.

Things that are easy to miss:

- User-facing and prompt text must exist in every locale (`en`, `ja`, `de`): the locale YAML, the `messages` files, and the `Record<Locale, ...>` tables in server code, which the compiler checks for every locale. Add new server text to such a table, not as a branch on the locale. `src/lib/app/locales.test.ts` and `src/i18n/messages.test.ts` check that every locale has the same config files, rules, modules, characters and message keys.
- Rule keywords match as substrings and turn the tools off, so in German they're whole phrases: `morgen` also means "tomorrow", so even `morgen mira` would catch "Wie wird das Wetter morgen Mira?".
- The committed `config/providers.yaml` uses OpenAI and ElevenLabs, with local Whisper at `http://whisper:8000`, compose's Whisper service. Under `bun run dev`, make `whisper` resolve or use another config through `PROVIDERS_CONFIG`. Ollama, and Whisper on another machine, are reached by IP address in their `baseUrl`, since `localhost` in compose's container is the container itself.
- `compose.yaml` passes an explicit env list, so a new variable, like `ELEVENLABS_API_KEY`, has to be added to it. Optional ones are written `${VAR:-}`, so they're blank without a warning when `.env` doesn't set them, and the code ignores blank values.
- No API route has authentication, so `compose.yaml` publishes port 3000 on localhost only, unless `BIND_ADDRESS` says otherwise.
- Logs, on the server and in the browser, never hold what was said, heard or seen: no transcripts, messages, replies, search queries, tool arguments, memories or camera descriptions. Log lengths, counts and names instead. `JSON.parse` errors quote the start of their input, so don't log those either. Unit tests check logs with `consoleOutput` from `src/lib/testing/console.ts`.
- The root layout is `force-dynamic`, so every page renders per request, and UI strings and `<html lang>` follow the locale the server finds, not the one at build time. Static pages would bring that back, and only `next build` shows it: the e2e `ja` and `de` servers, built in English, check it.
- The wake phrase is the picked character's `wakeWord.phrase` from `characters.yaml`, which the avatar page asks `/api/wakeword` for with `characterId`; `enabled` and `timeout` always come from `character.yaml`. Matching ignores case and punctuation but not spelling. Whisper writes English "OK" as "Okay", so English phrases start with "Hey", and German "Hey Mira" as "Herr Emira", so German ones start with "Hallo".
- The voice selector on `/control` lists the ElevenLabs account's voices, which `src/instrumentation.ts` loads once when the server starts, so restart to see voices added in ElevenLabs. Listing them needs the key's `voices_read` permission. The voice picked is saved in `user_settings.voice` and sent to `/api/tts` as `voice`. A character's `recommendedVoice` only applies if it's in that list.
- `next dev` also builds `src/instrumentation.ts` for the edge runtime, where `fs` can't be resolved, so its imports stay inside `if (process.env.NEXT_RUNTIME === "nodejs")`. After an early return they still get bundled, and every route then answers with a 500. `next build`, and so CI, doesn't show it.
- `/api/tts` removes emoji and markdown before speech, so what's spoken can differ from the reply on screen. ElevenLabs answers a wrong key, a missing permission and running out of credits all with a 401, and only `detail.status` tells them apart (`invalid_api_key`, `missing_permissions`, `quota_exceeded`).
- `/api/stt`, `/api/chat` and `/api/tts` answer failures with a `code` and `service` (`src/lib/errors/`), which both pages show in `messages/*.json` text and share over the channel through `useServiceErrors`. After a missing or rejected key, a missing permission, no credit, a spending limit or a rate limit, the avatar page skips that route for a while instead of asking on every utterance. The OpenAI clients have `maxRetries: 0`, so one request reaches OpenAI per attempt.

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
- **LLM tool:** register in the `tools` array in `src/lib/tools/index.ts`. Give it `isAvailable()` if it needs a key or config, so the LLM isn't offered a tool that can only fail.
- **Feature (prompt context):** register in `initializeFeatures` in `src/lib/features/registry.ts` and configure in `config/features.yaml`.
- **Provider:** LLM, STT, VLM and embedding each have `types.ts` and implementations under `src/lib/<kind>/`, with config types in `src/lib/providers/types.ts`. TTS has no abstraction: `src/app/api/tts/route.ts` calls ElevenLabs, with shared helpers in `src/lib/tts/elevenlabs.ts`.

The Dockerfile's runner stage contains only the standalone output and explicitly copied paths. Next's file tracing does include local plugin manifests, so `plugins/<name>/manifest.yaml` needs no `COPY`. Native modules and runtime files it can't trace need their own `COPY` line.

## Workflow

- PRs target `develop`. Commits follow Conventional Commits, and the prefixes drive PR labels.
- CI runs lint, test, build, e2e and a production dependency audit on PRs into `develop` and pushes to it, but only when `src/**`, `config/**`, `plugins/**`, `messages/**`, `package.json`, `bun.lock`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `e2e/**`, `playwright.config.ts`, `Dockerfile` or the CI workflow change. Changes confined to `docs/` don't trigger it.
- Pushes to `develop` deploy `docs/**` changes to GitHub Pages. `vX.Y.Z` tags publish multi-arch images to GHCR. `package.json`'s version and the app image in `compose.yaml` match the latest tag, so bump both in the change that a new tag goes on. Compose downloads the image `compose.yaml` names, and builds it only with `--build` or when the download fails.
