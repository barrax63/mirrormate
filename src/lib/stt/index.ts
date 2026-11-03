/**
 * Speech-to-Text (STT) Module
 * Re-exports all STT-related types and providers
 */

// Types
export type {
  STTProvider,
  TranscribeOptions,
  TranscribeResult,
  OpenAIWhisperConfig,
  LocalWhisperConfig,
  SilenceDetectionConfig,
  STTPurpose,
  WakeWordRecordingConfig,
  STTConfig,
  STTClientConfig,
} from "./types";

export { DEFAULT_SILENCE_CONFIG, DEFAULT_WAKE_WORD_RECORDING } from "./types";

// Providers
export { OpenAIWhisperProvider } from "./openai-whisper";
export { LocalWhisperProvider } from "./local-whisper";
