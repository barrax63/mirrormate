import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { ChatCompletionOptions, ChatCompletionResult } from "@/lib/llm";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  getAllContexts: vi.fn(),
  getFeatureContext: vi.fn(),
  findOrCreate: vi.fn(),
  retrieve: vi.fn(),
  formatContext: vi.fn(),
  getSimpleContext: vi.fn(),
  touchMemories: vi.fn(),
  processConversation: vi.fn(),
  analyzeImage: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  getLLMProvider: () => ({ chat: mocks.chat }),
}));

vi.mock("@/lib/features/registry", () => ({
  initializeFeatures: vi.fn(),
  getAllContexts: mocks.getAllContexts,
  getFeatureContext: mocks.getFeatureContext,
}));

vi.mock("@/lib/repositories", () => ({
  getUserRepository: () => ({ findOrCreate: mocks.findOrCreate }),
}));

vi.mock("@/lib/providers", () => ({
  loadProvidersConfig: () => ({ providers: { memory: { enabled: true } } }),
  getEmbeddingProvider: () => ({}),
}));

vi.mock("@/lib/memory", () => ({
  RAGService: class {
    retrieve = mocks.retrieve;
    formatContext = mocks.formatContext;
  },
  MemoryService: class {
    touchMemories = mocks.touchMemories;
    processConversation = mocks.processConversation;
  },
  getSimpleContext: mocks.getSimpleContext,
}));

vi.mock("@/lib/vlm", () => ({
  getVLMProvider: () => ({ analyzeImage: mocks.analyzeImage }),
}));

const JAPANESE = /[぀-ヿ㐀-鿿]/;

const text = (content: string): ChatCompletionResult => ({ content, finishReason: "stop" });

const toolCalls = (...calls: [string, Record<string, unknown>?][]): ChatCompletionResult => ({
  content: "",
  finishReason: "tool_calls",
  toolCalls: calls.map(([name, args = {}], i) => ({ id: `call_${i}`, name, arguments: args })),
});

let llmRequests: ChatCompletionOptions[];

// Replays the replies in order and then repeats the last one. The route mutates its
// message array between calls, so each request is copied when it arrives.
function scriptLLM(...replies: ChatCompletionResult[]) {
  mocks.chat.mockImplementation(async (options: ChatCompletionOptions) => {
    llmRequests.push(structuredClone(options));
    return replies.length > 1 ? replies.shift() : replies[0];
  });
}

async function post(body: Record<string, unknown>) {
  const response = await POST(
    new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ withAudio: false, ...body }),
    })
  );
  return { status: response.status, body: await response.json() };
}

const say = (content: string, extra: Record<string, unknown> = {}) =>
  post({ messages: [{ role: "user", content }], ...extra });

const systemPrompt = (request = llmRequests[0]) => request.messages[0].content;

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("LOCALE", "en");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    llmRequests = [];
    mocks.getAllContexts.mockResolvedValue("MOCK FEATURES");
    mocks.getFeatureContext.mockImplementation(async (name: string) => `MOCK ${name}`);
    mocks.retrieve.mockResolvedValue({ usedMemoryIds: [] });
    mocks.formatContext.mockReturnValue("");
    mocks.touchMemories.mockResolvedValue(undefined);
    mocks.processConversation.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("keyword rules", () => {
    it("offers tools and adds feature context when no rule matches", async () => {
      scriptLLM(text("Hi"));

      const { status, body } = await say("hello");

      expect(status).toBe(200);
      expect(body.message).toBe("Hi");
      expect(llmRequests[0].tools?.map((tool) => tool.name)).toEqual([
        "see_camera",
        "web_search",
        "show_effect",
        "share_to_discord",
      ]);
      expect(systemPrompt()).toContain("[Current Information]\nMOCK FEATURES");
      expect(systemPrompt()).not.toContain("[Information from Rule]");
    });

    it("disables tools and skips feature context when a rule matches", async () => {
      scriptLLM(text("Sleep well"));

      const { body } = await say("Well, GOOD NIGHT Mira");

      expect(body.message).toBe("Sleep well");
      expect(body.toolsUsed).toBe(false);
      expect(mocks.chat).toHaveBeenCalledOnce();
      expect(llmRequests[0].tools).toBeUndefined();
      expect(mocks.getAllContexts).not.toHaveBeenCalled();
      expect(systemPrompt()).not.toContain("[Current Information]");
      expect(systemPrompt()).toContain("[Information from Rule]");
      expect(systemPrompt()).toContain("MOCK calendar");
      expect(systemPrompt()).toContain("MOCK weather");
      expect(systemPrompt()).toContain("[Response Hint]");
    });

    it("keeps tools disabled but uses feature context when the rule's modules return nothing", async () => {
      scriptLLM(text("Sleep well"));
      mocks.getFeatureContext.mockResolvedValue("");

      await say("good night");

      expect(llmRequests[0].tools).toBeUndefined();
      expect(systemPrompt()).toContain("[Current Information]\nMOCK FEATURES");
      expect(systemPrompt()).not.toContain("[Response Hint]");
    });

    it("only matches the last user message", async () => {
      scriptLLM(text("Hi"));

      await post({
        messages: [
          { role: "user", content: "good night" },
          { role: "assistant", content: "good night" },
          { role: "user", content: "hello" },
        ],
      });

      expect(llmRequests[0].tools).toBeDefined();
      expect(systemPrompt()).not.toContain("[Information from Rule]");
    });
  });

  describe("tool loop", () => {
    it("sends tool results back to the LLM and returns its final text", async () => {
      scriptLLM(toolCalls(["show_effect", { effect: "confetti" }]), text("Done"));

      const { body } = await say("celebrate");

      expect(body.message).toBe("Done");
      expect(body.toolsUsed).toBe(true);
      expect(mocks.chat).toHaveBeenCalledTimes(2);
      expect(llmRequests[1].messages.slice(-2)).toEqual([
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_0",
              function: { name: "show_effect", arguments: '{"effect":"confetti"}' },
            },
          ],
        },
        { role: "tool", content: "Displaying confetti effect", tool_call_id: "call_0" },
      ]);
    });

    it("runs every tool call in a response", async () => {
      scriptLLM(
        toolCalls(["show_effect", { effect: "hearts" }], ["show_effect", { effect: "sparkles" }]),
        text("Done")
      );

      const { body } = await say("celebrate");

      const results = llmRequests[1].messages.filter((m) => m.role === "tool");
      expect(results.map((m) => m.content)).toEqual([
        "Displaying hearts effect",
        "Displaying sparkles effect",
      ]);
      expect(body.effect).toBe("sparkles");
    });

    it("reports an unknown tool to the LLM instead of failing", async () => {
      scriptLLM(toolCalls(["no_such_tool"]), text("Sorry"));

      const { status, body } = await say("do something");

      expect(status).toBe(200);
      expect(body.message).toBe("Sorry");
      expect(llmRequests[1].messages.at(-1)?.content).toBe('Tool "no_such_tool" not found.');
    });

    it("stops after 3 iterations", async () => {
      scriptLLM(toolCalls(["show_effect", { effect: "hearts" }]));

      const { status, body } = await say("keep going");

      expect(status).toBe(200);
      expect(mocks.chat).toHaveBeenCalledTimes(3);
      expect(body.toolsUsed).toBe(true);
      expect(body.effect).toBe("hearts");
    });

    // Known bug: the avatar says nothing. Remove .fails when the route makes a final
    // call without tools or returns a fallback line.
    it.fails("returns a non-empty reply when the tool limit is reached", async () => {
      scriptLLM(toolCalls(["show_effect", { effect: "hearts" }]));

      const { body } = await say("keep going");

      expect(body.message).not.toBe("");
    });

    // Known bug: seen with gpt-oss:20b when thinking uses up maxTokens. Remove .fails
    // when the route returns something else.
    it.fails("returns a non-empty reply when the LLM returns no content", async () => {
      scriptLLM(text(""));

      const { body } = await say("hello");

      expect(body.message).not.toBe("");
    });
  });

  describe("effects", () => {
    it("returns the effect set by a tool", async () => {
      scriptLLM(toolCalls(["show_effect", { effect: "confetti" }]), text("Yay"));

      const { body } = await say("celebrate");

      expect(body.effect).toBe("confetti");
    });

    it("doesn't carry an effect over to the next request", async () => {
      scriptLLM(toolCalls(["show_effect", { effect: "confetti" }]), text("Yay"));
      await say("celebrate");

      scriptLLM(text("Hi"));
      const { body } = await say("hello");

      expect(body.effect).toBeUndefined();
    });
  });

  describe("camera image", () => {
    it("adds the camera hint only when an image is sent", async () => {
      scriptLLM(text("Hi"));

      await say("hello");
      await say("hello", { image: "data:image/jpeg;base64,AAAA" });

      expect(systemPrompt(llmRequests[0])).not.toContain("[Tool Usage]");
      expect(systemPrompt(llmRequests[1])).toContain("[Tool Usage]");
    });

    it("passes the image to see_camera and returns the description to the LLM", async () => {
      const image = "data:image/jpeg;base64,AAAA";
      mocks.analyzeImage.mockResolvedValue("A person holding a mug");
      scriptLLM(toolCalls(["see_camera", { focus: "their hands" }]), text("Nice mug"));

      const { body } = await say("what am I holding?", { image });

      expect(mocks.analyzeImage).toHaveBeenCalledWith(image, expect.stringContaining("their hands"));
      expect(llmRequests[1].messages.at(-1)?.content).toBe("A person holding a mug");
      expect(body.message).toBe("Nice mug");
    });
  });

  describe("memory", () => {
    it("adds RAG context and marks the memories as used", async () => {
      scriptLLM(text("Hi"));
      mocks.retrieve.mockResolvedValue({ usedMemoryIds: ["m1"] });
      mocks.formatContext.mockReturnValue("MOCK MEMORIES");

      await say("hello");

      expect(mocks.retrieve).toHaveBeenCalledWith("default-user", "hello", {
        topK: 8,
        threshold: 0.3,
      });
      expect(systemPrompt()).toContain("MOCK MEMORIES");
      expect(mocks.touchMemories).toHaveBeenCalledWith(["m1"]);
    });

    it("falls back to the simple context when RAG fails", async () => {
      scriptLLM(text("Hi"));
      mocks.retrieve.mockRejectedValue(new Error("embedding server down"));
      mocks.getSimpleContext.mockResolvedValue("MOCK SIMPLE CONTEXT");

      const { status } = await say("hello");

      expect(status).toBe(200);
      expect(systemPrompt()).toContain("MOCK SIMPLE CONTEXT");
    });

    it("doesn't wait for memory extraction", async () => {
      scriptLLM(text("Hi"));
      mocks.processConversation.mockReturnValue(new Promise(() => {}));

      const { status, body } = await say("hello");

      expect(status).toBe(200);
      expect(body.message).toBe("Hi");
      expect(mocks.processConversation).toHaveBeenCalledOnce();
    });

    it("only logs a failed memory extraction", async () => {
      scriptLLM(text("Hi"));
      mocks.processConversation.mockRejectedValue(new Error("LLM down"));

      const { status, body } = await say("hello");

      expect(status).toBe(200);
      expect(body.message).toBe("Hi");
      await vi.waitFor(() =>
        expect(console.error).toHaveBeenCalledWith("[Chat] Memory extraction failed:", expect.any(Error))
      );
    });

    it("extracts from the last 10 messages plus the reply", async () => {
      scriptLLM(text("Reply"));
      mocks.retrieve.mockResolvedValue({ usedMemoryIds: ["m1"] });
      const messages = Array.from({ length: 13 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `message ${i}`,
      }));

      await post({ messages });

      const [userId, conversation, usedIds] = mocks.processConversation.mock.calls[0];
      expect(userId).toBe("default-user");
      expect(usedIds).toEqual(["m1"]);
      expect(conversation).toHaveLength(11);
      expect(conversation[0].content).toBe("message 3");
      expect(conversation.at(-1)).toEqual({ role: "assistant", content: "Reply" });
    });

    it("skips extraction when the reply is empty", async () => {
      scriptLLM(text(""));

      await say("hello");

      expect(mocks.processConversation).not.toHaveBeenCalled();
    });
  });

  describe("errors", () => {
    it("returns 500 when the LLM fails", async () => {
      mocks.chat.mockRejectedValue(new Error("connection refused"));

      const { status, body } = await say("hello");

      expect(status).toBe(500);
      expect(body).toEqual({ error: "Failed to generate response" });
    });
  });

  describe("known bugs", () => {
    // The avatar's message array is never trimmed, so every voice turn resends the
    // whole conversation. Remove .fails when the route trims history.
    it.fails("sends the system prompt plus at most 20 history messages to the LLM", async () => {
      scriptLLM(text("Hi"));
      const messages = Array.from({ length: 100 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `message ${i}`,
      }));

      await post({ messages });

      expect(llmRequests[0].messages.length).toBeLessThanOrEqual(21);
    });

    // The show_effect and web_search tool descriptions are always Japanese. Remove
    // .fails when they follow the locale.
    it.fails("sends no Japanese to the LLM in English mode", async () => {
      scriptLLM(text("Hi"));

      await say("hello");

      expect(JSON.stringify(llmRequests[0])).not.toMatch(JAPANESE);
    });
  });
});
