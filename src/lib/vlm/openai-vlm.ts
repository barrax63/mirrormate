import OpenAI from "openai";
import { VLMProvider, WavingResult, OpenAIVLMConfig } from "./types";
import { WAVING_PROMPT, parseWavingResponse } from "./waving";

/**
 * OpenAI VLM Provider
 *
 * Sends images to a chat model that accepts them, gpt-6-luna by default
 */
export class OpenAIVLMProvider implements VLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(config: OpenAIVLMConfig = {}) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      // As for the LLM: the SDK would retry a 429 twice, even without credit
      maxRetries: 0,
    });
    this.model = config.model || "gpt-6-luna";
  }

  async analyzeImage(image: string, prompt: string): Promise<string> {
    // The camera sends a data URL, and the API takes one. A bare base64 string is a JPEG.
    const url = image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`;

    console.log(`[VLM] Sending image to ${this.model}...`);

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url } },
          ],
        },
      ],
      // temperature is only accepted with reasoning off
      reasoning_effort: "none",
      max_completion_tokens: 300,
      // Low temperature for consistent JSON output
      temperature: 0.1,
    });

    const content = completion.choices[0]?.message?.content || "";
    console.log(`[VLM] Response: ${content.length} characters`);

    return content;
  }

  async checkWaving(image: string): Promise<WavingResult> {
    try {
      const response = await this.analyzeImage(image, WAVING_PROMPT);

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
