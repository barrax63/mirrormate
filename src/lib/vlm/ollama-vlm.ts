import dns from "dns";
import { VLMProvider, WavingResult, OllamaVLMConfig } from "./types";
import { WAVING_PROMPT, parseWavingResponse } from "./waving";

// Force IPv4 first to avoid ETIMEDOUT on some networks
dns.setDefaultResultOrder("ipv4first");

interface OllamaVLMResponse {
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

export class OllamaVLMProvider implements VLMProvider {
  private baseUrl: string;
  private model: string;

  constructor(config: OllamaVLMConfig = {}) {
    this.baseUrl = config.baseUrl || "http://localhost:11434";
    this.model = config.model || "llava:7b";
  }

  async analyzeImage(imageBase64: string, prompt: string): Promise<string> {
    // Remove data URL prefix if present
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const requestBody = {
      model: this.model,
      messages: [
        {
          role: "user",
          content: prompt,
          images: [base64Data],
        },
      ],
      stream: false,
      options: {
        temperature: 0.1, // Low temperature for consistent JSON output
      },
    };

    console.log(`[VLM] Sending image to ${this.model}...`);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[VLM] API error ${response.status}:`, errorText);
      throw new Error(`Ollama VLM API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as OllamaVLMResponse;
    const content = data.message?.content || "";
    console.log(`[VLM] Response: ${content.length} characters`);

    return content;
  }

  async checkWaving(imageBase64: string): Promise<WavingResult> {
    try {
      const response = await this.analyzeImage(imageBase64, WAVING_PROMPT);

      return parseWavingResponse(response);
    } catch (error) {
      console.error("[VLM] checkWaving error:", error);
      return {
        waving: false,
        confidence: 0,
        reason: "Error: " + (error instanceof Error ? error.message : "Unknown"),
      };
    }
  }
}
