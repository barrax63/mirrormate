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
  provider: "ollama";
  ollama?: {
    model?: string;
    baseUrl?: string;
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
  provider: "ollama";
  ollama?: {
    model?: string;
    baseUrl?: string;
  };
}

export interface STTProviderConfig extends ProviderConfig {
  provider: "openai" | "local" | "web";
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
  web?: {
    language?: string;
  };
  silenceDetection?: {
    silenceThreshold?: number;
    volumeThreshold?: number;
    minRecordingDuration?: number;
    maxRecordingDuration?: number;
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
    [key: string]: ProviderConfig | MemoryConfig | undefined;
  };
}
