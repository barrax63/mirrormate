import { loadProvidersConfig } from "./config-loader";
import { STTProviderConfig } from "./types";
import {
  STTProvider,
  STTPurpose,
  STTClientConfig,
  WakeWordRecordingConfig,
  DEFAULT_SILENCE_CONFIG,
  DEFAULT_WAKE_WORD_RECORDING,
  OpenAIWhisperProvider,
  LocalWhisperProvider,
} from "../stt";
import { ServiceError } from "../errors/service-error";

const cachedProviders = new Map<STTPurpose, STTProvider>();

/**
 * Get the STT provider for one purpose, based on configuration.
 * Returns null if it's disabled, or for speech if the provider is "web" (handled client-side).
 *
 * Wake word audio only ever goes to local Whisper, so what's said in the room before the wake
 * word stays on this machine. If that fails, so does the request: it never falls back to
 * stt.provider.
 */
export function getSTTProvider(purpose: STTPurpose): STTProvider | null {
  const cached = cachedProviders.get(purpose);
  if (cached) {
    return cached;
  }

  const config = loadProvidersConfig();
  const sttConfig = config.providers?.stt;

  if (!sttConfig?.enabled) {
    console.log("[STT] STT is disabled");
    return null;
  }

  if (purpose === "wakeWord") {
    const provider: string = sttConfig.wakeWord?.provider ?? "local";
    if (provider !== "local") {
      console.error(
        `[STT] stt.wakeWord.provider is ${provider}, but only local is allowed: wake word audio stays on this machine`
      );
      return null;
    }
    return createProvider("local", sttConfig, purpose);
  }

  const provider = sttConfig.provider || "web";

  // "web" provider is handled client-side via Web Speech API
  if (provider === "web") {
    console.log("[STT] Using Web Speech API (client-side)");
    return null;
  }

  if (provider === "openai" || provider === "local") {
    return createProvider(provider, sttConfig, purpose);
  }

  console.warn(`[STT] Unknown provider: ${provider}, falling back to web`);
  return null;
}

function createProvider(
  provider: "openai" | "local",
  sttConfig: STTProviderConfig,
  purpose: STTPurpose
): STTProvider | null {
  try {
    const created =
      provider === "openai"
        ? new OpenAIWhisperProvider(sttConfig.openai || {})
        : new LocalWhisperProvider(sttConfig.local || {});
    cachedProviders.set(purpose, created);
    console.log(
      provider === "openai"
        ? `[STT] Using OpenAI Whisper for ${purpose}`
        : `[STT] Using Local Whisper at ${sttConfig.local?.baseUrl || "http://localhost:8080"} for ${purpose}`
    );
    return created;
  } catch (error) {
    // A missing key, which /api/stt reports as such
    if (error instanceof ServiceError) {
      throw error;
    }
    console.error(`[STT] Failed to initialize ${provider} for ${purpose}:`, error);
    return null;
  }
}

/**
 * Get STT configuration for server-side use
 */
export function getSTTConfig(): STTProviderConfig {
  const config = loadProvidersConfig();
  return (
    config.providers?.stt || {
      enabled: false,
      provider: "web",
    }
  );
}

/** stt.wakeWord's recording settings, with the defaults for any that are missing or invalid */
function getWakeWordRecordingConfig(config: STTProviderConfig): WakeWordRecordingConfig {
  const { maxRecordingDuration, overlap } = config.wakeWord ?? {};
  const max =
    typeof maxRecordingDuration === "number" && maxRecordingDuration > 0
      ? maxRecordingDuration
      : DEFAULT_WAKE_WORD_RECORDING.maxRecordingDuration;
  const validOverlap =
    typeof overlap === "number" && overlap >= 0 ? overlap : DEFAULT_WAKE_WORD_RECORDING.overlap;
  // Each recording has to run for a while on its own, or they would pile up
  return { maxRecordingDuration: max, overlap: validOverlap < max ? validOverlap : max / 2 };
}

/**
 * Get client-safe STT configuration
 * Excludes sensitive information like API keys
 */
export function getSTTClientConfig(): STTClientConfig {
  const config = getSTTConfig();

  // Determine language based on provider
  let language = "en-US";
  if (config.provider === "openai" && config.openai?.language) {
    // Convert ISO 639-1 to BCP 47 for client
    language = config.openai.language === "ja" ? "ja-JP" : config.openai.language;
  } else if (config.provider === "local" && config.local?.language) {
    language = config.local.language === "ja" ? "ja-JP" : config.local.language;
  } else if (config.provider === "web" && config.web?.language) {
    language = config.web.language;
  }

  return {
    enabled: config.enabled ?? false,
    provider: config.provider || "web",
    silenceDetection: {
      ...DEFAULT_SILENCE_CONFIG,
      ...config.silenceDetection,
    },
    wakeWord: getWakeWordRecordingConfig(config),
    language,
  };
}

/**
 * Clear the cached STT providers
 * Useful for testing or when configuration changes
 */
export function clearSTTProviderCache(): void {
  cachedProviders.clear();
}
