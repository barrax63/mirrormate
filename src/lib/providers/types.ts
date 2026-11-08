export interface ProviderConfig {
  enabled: boolean;
  provider: string;
  [key: string]: unknown;
}

export interface TTSProviderConfig extends ProviderConfig {
  provider: "elevenlabs";
  elevenlabs?: {
    voiceId?: string;
    model?: string;
    baseUrl?: string;
  };
}

export interface LLMProviderConfig extends ProviderConfig {
  provider: "openai" | "ollama";
  /** Most recent messages of the conversation sent with each request, 20 by default */
  historyLimit?: number;
  openai?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  };
  ollama?: {
    model?: string;
    baseUrl?: string;
    maxTokens?: number;
    temperature?: number;
  };
}

export interface EmbeddingProviderConfig extends ProviderConfig {
  provider: "ollama" | "openai";
  ollama?: {
    model?: string;
    baseUrl?: string;
  };
  openai?: {
    model?: string;
  };
}

export interface MemoryConfig {
  enabled: boolean;
  rag?: {
    topK?: number;
    threshold?: number;
  };
  extraction?: {
    autoExtract?: boolean;
    minConfidence?: number;
  };
}

export interface VLMProviderConfig extends ProviderConfig {
  provider: "ollama" | "openai";
  ollama?: {
    model?: string;
    baseUrl?: string;
  };
  openai?: {
    model?: string;
  };
}

export interface STTProviderConfig extends ProviderConfig {
  /** For what's said after the wake word, or everything when the wake word is off */
  provider: "openai" | "local";
  /** For what's heard while waiting for the wake word, which never goes to a cloud service */
  wakeWord?: {
    provider?: "local";
    maxRecordingDuration?: number;
    overlap?: number;
  };
  openai?: {
    model?: string;
    language?: string;
    prompt?: string;
    temperature?: number;
  };
  local?: {
    baseUrl?: string;
    model?: string;
    language?: string;
  };
  silenceDetection?: {
    silenceThreshold?: number;
    volumeThreshold?: number;
    minRecordingDuration?: number;
    maxRecordingDuration?: number;
  };
}

/**
 * Prototype: GPT-Live holds the conversation after the wake word, in place of stt, llm and tts.
 * Off unless enabled, and only with the wake word on.
 */
export interface LiveConfig {
  enabled?: boolean;
  /** gpt-live-1 by default */
  model?: string;
  /** A GPT-Live voice. By default the locale's, from LIVE_VOICES in src/lib/live */
  voice?: string;
  /** Seconds without speech, heard or said, before the session closes. 30 by default */
  idleTimeout?: number;
  /** Seconds a session may last at most. 300 by default */
  maxDuration?: number;
  backend?: {
    /** The Responses model GPT-Live hands harder questions to. gpt-6-luna by default */
    model?: string;
  };
}

export interface ProvidersConfig {
  providers: {
    llm?: LLMProviderConfig;
    tts?: TTSProviderConfig;
    stt?: STTProviderConfig;
    embedding?: EmbeddingProviderConfig;
    memory?: MemoryConfig;
    vlm?: VLMProviderConfig;
    live?: LiveConfig;
    [key: string]: ProviderConfig | MemoryConfig | LiveConfig | undefined;
  };
}
