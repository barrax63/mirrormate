import OpenAI from "openai";
import { EmbeddingProvider, EmbeddingResult, OpenAIEmbeddingConfig } from "./types";

/**
 * OpenAI Embedding Provider
 *
 * Generates embeddings with OpenAI's /v1/embeddings endpoint
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;
  private model: string;
  private dims: number | null = null;

  constructor(config: OpenAIEmbeddingConfig = {}) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      // As for the LLM: the SDK would retry a 429 twice, even without credit
      maxRetries: 0,
    });
    this.model = config.model || "text-embedding-3-small";
  }

  getModelName(): string {
    return this.model;
  }

  getDimensions(): number {
    if (this.dims === null) {
      throw new Error(
        "Embedding dimensions are not initialized. Dimensions are determined after the first successful embed() or embedBatch() call. Please call embed() (or embedBatch()) before accessing getDimensions()."
      );
    }
    return this.dims;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      encoding_format: "float",
    });

    if (response.data.length !== texts.length) {
      throw new Error(`OpenAI returned ${response.data.length} embeddings for ${texts.length} texts`);
    }

    // Each item carries the index of its input
    const vectors = [...response.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
    this.dims = vectors[0].length;

    // Stored under the configured name, which is what search compares with
    return vectors.map((vector) => ({ vector, model: this.model, dims: vector.length }));
  }
}
