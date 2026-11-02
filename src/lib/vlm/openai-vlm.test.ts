import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIVLMProvider } from "./openai-vlm";

const create = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const answer = (content: string) => ({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });

describe("OpenAIVLMProvider", () => {
  beforeEach(() => {
    create.mockReset();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends the image and prompt to gpt-6-luna with reasoning off", async () => {
    create.mockResolvedValue(answer("A person holding a mug."));

    const result = await new OpenAIVLMProvider().analyzeImage("data:image/jpeg;base64,QUJD", "What is this?");

    expect(result).toBe("A person holding a mug.");
    expect(create).toHaveBeenCalledWith({
      model: "gpt-6-luna",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } },
          ],
        },
      ],
      reasoning_effort: "none",
      max_completion_tokens: 300,
      temperature: 0.1,
    });
  });

  it("sends a bare base64 image as a JPEG data URL", async () => {
    create.mockResolvedValue(answer("ok"));

    await new OpenAIVLMProvider({ model: "other-model" }).analyzeImage("QUJD", "What is this?");

    const [params] = create.mock.calls[0];
    expect(params.model).toBe("other-model");
    expect(params.messages[0].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } });
  });

  it("reads a waving answer", async () => {
    create.mockResolvedValue(answer('{"waving": true, "confidence": 0.9, "reason": "hand raised"}'));

    const result = await new OpenAIVLMProvider().checkWaving("data:image/jpeg;base64,QUJD");

    expect(result).toMatchObject({ waving: true, confidence: 0.9, reason: "hand raised" });
  });

  it("reports a failed waving check as not waving", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockRejectedValue(new Error("network down"));

    const result = await new OpenAIVLMProvider().checkWaving("data:image/jpeg;base64,QUJD");

    expect(result).toEqual({ waving: false, confidence: 0, reason: "Error: network down" });
  });
});
