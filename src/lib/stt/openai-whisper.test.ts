import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIWhisperProvider } from "./openai-whisper";
import { consoleOutput } from "../testing/console";

const create = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class {
    audio = { transcriptions: { create } };
  },
}));

describe("OpenAIWhisperProvider", () => {
  beforeEach(() => {
    create.mockReset();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns the transcript, and doesn't log it", async () => {
    create.mockResolvedValue({
      text: "Tell me about my dentist appointment",
      languages: [{ code: "en" }],
      usage: { type: "duration", seconds: 2 },
    });

    const result = await new OpenAIWhisperProvider().transcribe(Buffer.from("audio"), { language: "en" });

    expect(result).toEqual({ transcript: "Tell me about my dentist appointment", language: "en", duration: 2 });
    expect(consoleOutput()).toContain("[OpenAIWhisperProvider] Transcription complete: 36 characters");
    expect(consoleOutput()).not.toContain("dentist");
  });
});
