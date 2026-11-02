import { VLMProvider, VLMConfig } from "./types";
import { OllamaVLMProvider } from "./ollama-vlm";
import { OpenAIVLMProvider } from "./openai-vlm";
import { loadProvidersConfig } from "../providers/config-loader";

export * from "./types";
export { OllamaVLMProvider } from "./ollama-vlm";
export { OpenAIVLMProvider } from "./openai-vlm";

let vlmProvider: VLMProvider | null = null;

export function getVLMProvider(): VLMProvider | null {
  if (vlmProvider) {
    return vlmProvider;
  }

  const config = loadProvidersConfig();
  const vlmConfig = config.providers?.vlm as VLMConfig | undefined;

  if (!vlmConfig?.enabled) {
    console.log("[VLM] VLM provider is disabled");
    return null;
  }

  if (vlmConfig.provider === "ollama") {
    vlmProvider = new OllamaVLMProvider(vlmConfig.ollama);
    console.log("[VLM] Initialized Ollama VLM provider");
    return vlmProvider;
  }

  if (vlmConfig.provider === "openai") {
    try {
      vlmProvider = new OpenAIVLMProvider(vlmConfig.openai);
    } catch (error) {
      console.error("[VLM] Failed to initialize OpenAI VLM provider:", error);
      return null;
    }
    console.log("[VLM] Initialized OpenAI VLM provider");
    return vlmProvider;
  }

  console.warn(`[VLM] Unknown provider: ${vlmConfig.provider}`);
  return null;
}

export function clearVLMProviderCache(): void {
  vlmProvider = null;
}
