import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIEmbeddingProvider } from "./openai";

const create = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class {
    embeddings = { create };
  },
}));

describe("OpenAIEmbeddingProvider", () => {
  beforeEach(() => {
    create.mockReset();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("asks text-embedding-3-small for floats, and returns vectors in input order", async () => {
    create.mockResolvedValue({
      data: [
        { object: "embedding", index: 1, embedding: [0, 1] },
        { object: "embedding", index: 0, embedding: [1, 0] },
      ],
      model: "text-embedding-3-small",
    });

    const results = await new OpenAIEmbeddingProvider().embedBatch(["first", "second"]);

    expect(create).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: ["first", "second"],
      encoding_format: "float",
    });
    expect(results).toEqual([
      { vector: [1, 0], model: "text-embedding-3-small", dims: 2 },
      { vector: [0, 1], model: "text-embedding-3-small", dims: 2 },
    ]);
  });

  it("stores vectors under the configured model, which search compares with", async () => {
    create.mockResolvedValue({ data: [{ index: 0, embedding: [1, 0, 0] }], model: "text-embedding-3-large-2026" });

    const result = await new OpenAIEmbeddingProvider({ model: "text-embedding-3-large" }).embed("hello");

    expect(result).toEqual({ vector: [1, 0, 0], model: "text-embedding-3-large", dims: 3 });
  });

  it("fails when the answer has the wrong number of vectors", async () => {
    create.mockResolvedValue({ data: [{ index: 0, embedding: [1] }] });

    await expect(new OpenAIEmbeddingProvider().embedBatch(["a", "b"])).rejects.toThrow(
      "OpenAI returned 1 embeddings for 2 texts"
    );
  });

  it("needs a key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    expect(() => new OpenAIEmbeddingProvider()).toThrow("OPENAI_API_KEY is not configured");
  });
});
