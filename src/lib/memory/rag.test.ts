import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetDb } from "../db";
import { getMemoryRepository, getUserRepository } from "../repositories";
import type { EmbeddingProvider, EmbeddingResult } from "../embedding";
import { RAGService } from "./rag";

const USER = "rag-test-user";

// Texts with similar characters get similar vectors, as in the e2e mock
function vectorFor(text: string, dims: number): number[] {
  const vector = new Array(dims).fill(0);
  for (const char of text.toLowerCase()) vector[char.charCodeAt(0) % dims] += 1;
  return vector;
}

class FakeEmbedding implements EmbeddingProvider {
  batches: string[][] = [];

  constructor(private model: string, private dims: number) {}

  getModelName() {
    return this.model;
  }

  getDimensions() {
    return this.dims;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    return { vector: vectorFor(text, this.dims), model: this.model, dims: this.dims };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    this.batches.push(texts);
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

describe("RAGService with memories from another embedding model", () => {
  let dir: string;
  const repo = getMemoryRepository();

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirrormate-rag-"));
    vi.stubEnv("DATABASE_PATH", path.join(dir, "test.db"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    await getUserRepository().findOrCreate(USER);
  });

  afterEach(() => {
    resetDb();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // A memory with a 2048-dimension vector, as PLaMo stored them, and one with no vector
  async function storeOldMemories() {
    const coffee = await repo.create({ userId: USER, kind: "knowledge", title: "Favorite drink", content: "coffee" });
    await repo.saveEmbedding(coffee.id, new Array(2048).fill(0.01), "plamo-embedding-1b", 2048);
    const birthday = await repo.create({ userId: USER, kind: "knowledge", title: "Sister's birthday", content: "June 3" });
    return { coffee, birthday };
  }

  it("embeds them with the current model before searching, and then finds them", async () => {
    const { coffee, birthday } = await storeOldMemories();
    const embedding = new FakeEmbedding("text-embedding-3-small", 16);

    const context = await new RAGService(embedding).retrieve(USER, "favorite drink coffee", { threshold: 0 });

    expect(embedding.batches).toEqual([["Favorite drink: coffee", "Sister's birthday: June 3"]]);
    expect(context.retrievedMemories.map((r) => r.memory.id)).toEqual(expect.arrayContaining([coffee.id, birthday.id]));
    expect(context.retrievedMemories[0].memory.id).toBe(coffee.id);
    for (const id of [coffee.id, birthday.id]) {
      const stored = await repo.findByIdWithEmbedding(id);
      expect(stored?.embedding).toMatchObject({ model: "text-embedding-3-small", dims: 16 });
    }
  });

  it("embeds them once, even when two requests arrive together", async () => {
    await storeOldMemories();
    const embedding = new FakeEmbedding("text-embedding-3-small", 16);
    const rag = new RAGService(embedding);

    await Promise.all([rag.retrieve(USER, "coffee"), rag.retrieve(USER, "birthday")]);
    await rag.retrieve(USER, "coffee again");

    expect(embedding.batches).toHaveLength(1);
  });

  it("leaves memories alone that already have the current model's vectors", async () => {
    const embedding = new FakeEmbedding("text-embedding-3-small", 16);
    const tea = await repo.create({ userId: USER, kind: "knowledge", title: "Favorite tea", content: "green" });
    const { vector, model, dims } = await embedding.embed("Favorite tea: green");
    await repo.saveEmbedding(tea.id, vector, model, dims);

    const context = await new RAGService(embedding).retrieve(USER, "favorite tea", { threshold: 0 });

    expect(embedding.batches).toEqual([]);
    expect(context.retrievedMemories.map((r) => r.memory.id)).toEqual([tea.id]);
  });
});
