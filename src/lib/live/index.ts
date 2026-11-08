import OpenAI from "openai";
import { getLocale, type Locale } from "@/lib/app";
import { getSystemPrompt, getSystemPromptForCharacter } from "@/lib/character";
import { getAllContexts } from "@/lib/features/registry";
import { getLLMProvider } from "@/lib/llm";
import { getSimpleContext, MemoryService } from "@/lib/memory";
import { loadProvidersConfig, getEmbeddingProvider } from "@/lib/providers";
import { ServiceError } from "@/lib/errors/service-error";
import type { LiveClientConfig } from "./types";

export type { LiveClientConfig, LiveMessage, LiveRole } from "./types";

/** GPT-Live's voices for each language, where providers.live.voice doesn't name one */
export const LIVE_VOICES: Record<Locale, string> = {
  en: "marin",
  de: "nuri",
  ja: "harema",
};

const DEFAULT_MODEL = "gpt-live-1";
const DEFAULT_BACKEND_MODEL = "gpt-6-luna";

// What the avatar page's data channel may receive and send. It only shows transcripts and
// closes the session, so it can't change the instructions or the backend.
const PAGE_SERVER_EVENTS = [
  "session.started",
  "session.input_transcript.delta",
  "session.output_transcript.delta",
  "session.usage.updated",
  "session.closed",
  "error",
];
const PAGE_CLIENT_EVENTS = ["session.close"];

const seconds = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function getLiveClientConfig(): LiveClientConfig {
  const live = loadProvidersConfig().providers?.live;
  return {
    enabled: live?.enabled === true,
    idleTimeout: seconds(live?.idleTimeout, 5, 600, 30),
    maxDuration: seconds(live?.maxDuration, 30, 3600, 300),
  };
}

/**
 * What GPT-Live knows from the start: the character, the user's profile memories, and the
 * current information that /api/chat adds when no rule matches. Nothing is asked yet, so
 * there's no question to look up related memories for.
 */
export async function buildLiveInstructions(userId: string, characterId?: string): Promise<string> {
  const parts = [characterId ? getSystemPromptForCharacter(characterId) : getSystemPrompt()];

  if (loadProvidersConfig().providers?.memory?.enabled) {
    try {
      const profile = await getSimpleContext(userId);
      if (profile) parts.push(profile);
    } catch (error) {
      console.error("[Live] Couldn't read the user's profile memories:", error);
    }
  }

  const features = await getAllContexts();
  if (features) parts.push(`[Current Information]\n${features}`);

  return parts.join("\n\n");
}

/** Creates a GPT-Live session for the browser's SDP offer, and returns OpenAI's answer */
export async function createLiveSession(options: {
  sdp: string;
  userId: string;
  characterId?: string;
}): Promise<{ sdp: string; sessionId: string }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ServiceError("missing_key", "openai", "OPENAI_API_KEY is not configured");
  }

  const live = loadProvidersConfig().providers?.live;
  const instructions = await buildLiveInstructions(options.userId, options.characterId);
  // As for the other OpenAI clients: one request per attempt
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });

  const response = await client.live.create({
    session: {
      model: live?.model || DEFAULT_MODEL,
      instructions,
      audio: { output: { voice: live?.voice || LIVE_VOICES[getLocale()] } },
      // GPT-Live answers what it can itself, and hands the rest to this model
      delegation: {
        type: "responses",
        responses: {
          model: live?.backend?.model || DEFAULT_BACKEND_MODEL,
          instructions,
          reasoning: { effort: "none" },
        },
      },
      client: {
        data_channel: {
          allowed_client_events: PAGE_CLIENT_EVENTS,
          allowed_server_events: PAGE_SERVER_EVENTS.map((type) => ({ type })),
        },
      },
    },
    transport: { type: "webrtc", sdp: options.sdp },
  });

  return { sdp: response.transport.sdp, sessionId: response.session.id };
}

let memoryService: MemoryService | null = null;

/** Memory extraction for a finished session's transcript, as /api/chat runs it after a reply */
export function getLiveMemoryService(): MemoryService | null {
  if (memoryService) return memoryService;

  const memoryConfig = loadProvidersConfig().providers?.memory;
  if (!memoryConfig?.enabled) return null;

  memoryService = new MemoryService({
    llmProvider: getLLMProvider(),
    embeddingProvider: getEmbeddingProvider() || undefined,
    minConfidence: memoryConfig.extraction?.minConfidence ?? 0.5,
    autoExtract: memoryConfig.extraction?.autoExtract ?? true,
  });
  return memoryService;
}
