import OpenAI from "openai";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { ServiceError } from "@/lib/errors/service-error";
import type { ChatCompletionOptions, ChatCompletionResult } from "@/lib/llm";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  getAllContexts: vi.fn(),
  getFeatureContext: vi.fn(),
  findOrCreate: vi.fn(),
  findSettings: vi.fn(),
  retrieve: vi.fn(),
  formatContext: vi.fn(),
  getSimpleContext: vi.fn(),
  touchMemories: vi.fn(),
  processConversation: vi.fn(),
  analyzeImage: vi.fn(),
  llmConfig: {} as { historyLimit?: number },
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
  getUserSettingsRepository: () => ({ findOrCreate: mocks.findSettings }),
}));

vi.mock("@/lib/providers", () => ({
  loadProvidersConfig: () => ({ providers: { llm: mocks.llmConfig, memory: { enabled: true } } }),
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

// character.fallbackReply in config/locales/*/character.yaml
const FALLBACK_EN = "Hmm... I lost my train of thought! Could you say that again?";
const FALLBACK_JA = "うーん、考えがまとまらなかったみたい。もう一回言ってくれる？";

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
      body: JSON.stringify(body),
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
    mocks.findSettings.mockResolvedValue({ visionEnabled: true });
    mocks.llmConfig = {};
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

    it("stops calling tools after 3 iterations, and asks once more without them", async () => {
      const loop = toolCalls(["show_effect", { effect: "hearts" }]);
      scriptLLM(loop, loop, loop, text("All done!"));

      const { status, body } = await say("keep going");

      expect(status).toBe(200);
      expect(mocks.chat).toHaveBeenCalledTimes(4);
      expect(llmRequests.slice(0, 3).every((request) => request.tools?.length)).toBe(true);
      expect(llmRequests[3].tools).toBeUndefined();
      // With the results of the last round of tool calls
      expect(llmRequests[3].messages.at(-1)).toEqual({
        role: "tool",
        content: "Displaying hearts effect",
        tool_call_id: "call_0",
      });
      expect(body.message).toBe("All done!");
      expect(body.toolsUsed).toBe(true);
      expect(body.effect).toBe("hearts");
    });

    it("returns a non-empty reply when the tool limit is reached", async () => {
      scriptLLM(toolCalls(["show_effect", { effect: "hearts" }]));

      const { body } = await say("keep going");

      expect(body.message).toBe(FALLBACK_EN);
    });

    // Seen with gpt-oss:20b when thinking used up maxTokens
    it("asks once more without tools when the LLM returns no content", async () => {
      scriptLLM(text(""), text("Hi there!"));

      const { body } = await say("hello");

      expect(mocks.chat).toHaveBeenCalledTimes(2);
      expect(llmRequests[0].tools?.length).toBeGreaterThan(0);
      expect(llmRequests[1].tools).toBeUndefined();
      expect(llmRequests[1].messages).toEqual(llmRequests[0].messages);
      expect(body.message).toBe("Hi there!");
    });

    it("counts a reply of only whitespace as no content", async () => {
      scriptLLM(text(" \n "), text("Hi there!"));

      const { body } = await say("hello");

      expect(body.message).toBe("Hi there!");
    });

    it("returns a non-empty reply when the LLM returns no content", async () => {
      scriptLLM(text(""));

      const { body } = await say("hello");

      expect(mocks.chat).toHaveBeenCalledTimes(2);
      expect(body.message).toBe(FALLBACK_EN);
    });

    it("asks once more when a rule matched too, which offers no tools", async () => {
      scriptLLM(text(""), text("Sleep well"));

      const { body } = await say("good night");

      expect(mocks.chat).toHaveBeenCalledTimes(2);
      expect(llmRequests.map((request) => request.tools)).toEqual([undefined, undefined]);
      expect(body.message).toBe("Sleep well");
    });

    it("falls back to the Japanese line in Japanese mode", async () => {
      vi.stubEnv("LOCALE", "ja");
      scriptLLM(text(""));

      const { body } = await say("こんにちは");

      expect(body.message).toBe(FALLBACK_JA);
    });

    it("reports a failure of the call without tools", async () => {
      mocks.chat.mockResolvedValueOnce(text("")).mockRejectedValueOnce(new Error("connection refused"));

      const { status, body } = await say("hello");

      expect(status).toBe(500);
      expect(body).toEqual({ error: "connection refused", code: "failed" });
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

    it("drops the image while Vision is off, so see_camera has nothing to send", async () => {
      mocks.findSettings.mockResolvedValue({ visionEnabled: false });
      scriptLLM(toolCalls(["see_camera", { focus: "their hands" }]), text("I can't see you"));

      await say("what am I holding?", { image: "data:image/jpeg;base64,AAAA" });

      expect(systemPrompt(llmRequests[0])).not.toContain("[Tool Usage]");
      expect(mocks.analyzeImage).not.toHaveBeenCalled();
    });
  });

  describe("history", () => {
    // user 1, assistant 2, ... user n
    const conversation = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: String(i + 1) }));

    it("sends the LLM the last 20 messages by default, and says so", async () => {
      scriptLLM(text("Hi"));

      const { body } = await post({ messages: conversation(99) });

      const sent = llmRequests[0].messages.slice(1);
      expect(sent).toHaveLength(19);
      expect(sent[0]).toEqual({ role: "user", content: "81" });
      expect(sent.at(-1)).toEqual({ role: "user", content: "99" });
      expect(body.historyLimit).toBe(20);
    });

    it("sends the system prompt plus at most 20 history messages to the LLM", async () => {
      scriptLLM(text("Hi"));

      await post({ messages: conversation(100) });

      expect(llmRequests[0].messages.length).toBeLessThanOrEqual(21);
    });

    it("uses the configured limit", async () => {
      mocks.llmConfig = { historyLimit: 5 };
      scriptLLM(text("Hi"));

      const { body } = await post({ messages: conversation(99) });

      expect(llmRequests[0].messages.slice(1).map((m) => m.content)).toEqual(["95", "96", "97", "98", "99"]);
      expect(body.historyLimit).toBe(5);
    });

    it("extracts memories from the trimmed conversation", async () => {
      mocks.llmConfig = { historyLimit: 3 };
      scriptLLM(text("Hi"));

      await post({ messages: conversation(9) });

      const [, extracted] = mocks.processConversation.mock.calls[0];
      expect(extracted.map((m: { content: string }) => m.content)).toEqual(["7", "8", "9", "Hi"]);
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

    it("skips extraction after the fallback line", async () => {
      scriptLLM(text(""));

      await say("hello");

      expect(mocks.processConversation).not.toHaveBeenCalled();
    });

    it("extracts from the reply that came without tools", async () => {
      scriptLLM(text(""), text("Hi there!"));

      await say("hello");

      const [, conversation] = mocks.processConversation.mock.calls[0];
      expect(conversation.at(-1)).toEqual({ role: "assistant", content: "Hi there!" });
    });
  });

  describe("errors", () => {
    it("returns 500 when the LLM fails", async () => {
      mocks.chat.mockRejectedValue(new Error("connection refused"));

      const { status, body } = await say("hello");

      expect(status).toBe(500);
      expect(body).toEqual({ error: "connection refused", code: "failed" });
    });

    it("says when OpenAI rejected the key", async () => {
      mocks.chat.mockRejectedValue(
        OpenAI.APIError.generate(401, { error: { message: "Incorrect API key provided" } }, undefined, new Headers())
      );

      const { status, body } = await say("hello");

      expect(status).toBe(502);
      expect(body).toMatchObject({ code: "invalid_key", service: "openai" });
    });

    it("says when the key is missing", async () => {
      mocks.chat.mockRejectedValue(new ServiceError("missing_key", "openai", "OPENAI_API_KEY is not configured"));

      const { status, body } = await say("hello");

      expect(status).toBe(500);
      expect(body).toMatchObject({ code: "missing_key", service: "openai" });
    });
  });

  describe("languages", () => {
    // The system prompt with the camera hint, the tool definitions, and a rule's labels
    it("sends no Japanese to the LLM in English mode", async () => {
      scriptLLM(text("Hi"));

      await say("hello", { image: "data:image/jpeg;base64,AAAA" });
      await say("good night");

      expect(systemPrompt(llmRequests[0])).toContain("User's camera image is available.");
      expect(llmRequests[0].tools?.length).toBeGreaterThan(0);
      expect(systemPrompt(llmRequests[1])).toContain("[Information from Rule]");
      for (const request of llmRequests) {
        expect(JSON.stringify(request)).not.toMatch(JAPANESE);
      }
    });

    it("sends the same in Japanese in Japanese mode", async () => {
      vi.stubEnv("LOCALE", "ja");
      scriptLLM(text("こんにちは"));

      await say("こんにちは", { image: "data:image/jpeg;base64,AAAA" });

      expect(systemPrompt()).toContain("ユーザーのカメラ画像が利用可能です。");
      expect(systemPrompt()).toContain("性格:");
      expect(llmRequests[0].tools?.find((tool) => tool.name === "show_effect")?.description).toMatch(
        /^画面にエフェクトを表示します。/
      );
    });
  });
});
