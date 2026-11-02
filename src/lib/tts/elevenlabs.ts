import type { TTSProviderConfig } from "../providers/types";

type ElevenLabsConfig = TTSProviderConfig["elevenlabs"];

export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";
// Sarah, a premade voice that every account has
export const ELEVENLABS_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
export const ELEVENLABS_MODEL = "eleven_v4_turbo";

export interface Voice {
  id: string;
  name: string;
}

export function getElevenLabsBaseUrl(config: ElevenLabsConfig): string {
  return (config?.baseUrl || ELEVENLABS_BASE_URL).replace(/\/+$/, "");
}

export function getElevenLabsApiKey(): string {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured");
  }
  return apiKey;
}

/**
 * The error for a refused request. A wrong key, a missing permission and running out of
 * credits are all 401s, and only detail.status tells them apart: invalid_api_key,
 * missing_permissions, quota_exceeded
 */
export async function elevenLabsError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null);
  const status = body?.detail?.status;
  return new Error(`ElevenLabs returned ${response.status}${status ? ` (${status})` : ""}`);
}

async function fetchVoices(config: ElevenLabsConfig): Promise<Voice[]> {
  const apiKey = getElevenLabsApiKey();
  const voices: Voice[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${getElevenLabsBaseUrl(config)}/v2/voices`);
    url.searchParams.set("page_size", "100");
    if (pageToken) url.searchParams.set("next_page_token", pageToken);

    // Listing voices needs the key's voices_read permission
    const response = await fetch(url, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw await elevenLabsError(response);
    }

    const page: { voices: { voice_id: string; name: string }[]; has_more: boolean; next_page_token?: string } =
      await response.json();
    voices.push(...page.voices.map((voice) => ({ id: voice.voice_id, name: voice.name })));
    pageToken = page.has_more ? page.next_page_token : undefined;
  } while (pageToken);

  return voices.sort((a, b) => a.name.localeCompare(b.name));
}

let voicesPromise: Promise<Voice[]> | null = null;

/**
 * The voices of the ElevenLabs account, default ones and any added to it. Loaded once per start,
 * so voices added in ElevenLabs appear after a restart. A failed load is tried again next time.
 */
export function listVoices(config: ElevenLabsConfig): Promise<Voice[]> {
  if (!voicesPromise) {
    voicesPromise = fetchVoices(config).catch((error) => {
      voicesPromise = null;
      throw error;
    });
  }
  return voicesPromise;
}
