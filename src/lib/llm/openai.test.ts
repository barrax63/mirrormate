import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIProvider } from "./openai";

const create = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const reply = (finish_reason: string, message: Record<string, unknown>) => ({
  choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason }],
});

describe("OpenAIProvider", () => {
  beforeEach(() => {
    create.mockReset();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("asks gpt-6-luna with reasoning off and a completion token limit", async () => {
    create.mockResolvedValue(reply("stop", { content: "hi" }));

    await new OpenAIProvider().chat({ messages: [{ role: "user", content: "hello" }] });

    const [params] = create.mock.calls[0];
    expect(params).toMatchObject({
      model: "gpt-6-luna",
      reasoning_effort: "none",
      max_completion_tokens: 300,
      temperature: 0.7,
    });
    // The API rejects max_tokens with a 400
    expect(params).not.toHaveProperty("max_tokens");
  });

  it("reports a reply cut off at the token limit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    create.mockResolvedValue(reply("length", { content: "a reply that got cut" }));

    const result = await new OpenAIProvider().chat({ messages: [{ role: "user", content: "hello" }] });

    expect(result).toEqual({ content: "a reply that got cut", finishReason: "length" });
  });

  it("reads function tool calls", async () => {
    create.mockResolvedValue(
      reply("tool_calls", {
        content: "One sec!",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "show_effect", arguments: '{"effect":"confetti"}' } },
        ],
      })
    );

    const result = await new OpenAIProvider().chat({ messages: [{ role: "user", content: "confetti" }] });

    expect(result).toEqual({
      content: "One sec!",
      toolCalls: [{ id: "call_1", name: "show_effect", arguments: { effect: "confetti" } }],
      finishReason: "tool_calls",
    });
  });
});
