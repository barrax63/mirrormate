import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ServiceError } from "@/lib/errors/service-error";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  clientOptions: [] as unknown[],
  providers: {} as Record<string, unknown>,
  getSimpleContext: vi.fn(),
  getAllContexts: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class {
    live = { create: mocks.create };
    constructor(options: unknown) {
      mocks.clientOptions.push(options);
    }
  },
}));

vi.mock("@/lib/providers", () => ({
  loadProvidersConfig: () => ({ providers: mocks.providers }),
  getEmbeddingProvider: () => null,
}));

vi.mock("@/lib/features/registry", () => ({
  getAllContexts: mocks.getAllContexts,
}));

vi.mock("@/lib/memory", () => ({
  getSimpleContext: mocks.getSimpleContext,
  MemoryService: class {},
}));

vi.mock("@/lib/llm", () => ({ getLLMProvider: () => ({}) }));

import { buildLiveInstructions, createLiveSession, getLiveClientConfig } from "./index";
import { clearCharacterCache, clearCharactersCache } from "@/lib/character";

describe("live mode", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("LOCALE", "en");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    clearCharacterCache();
    clearCharactersCache();
    mocks.clientOptions.length = 0;
    mocks.providers = { live: { enabled: true }, memory: { enabled: true } };
    mocks.getSimpleContext.mockResolvedValue("[User Profile]\n- Name: Alex");
    mocks.getAllContexts.mockResolvedValue("Time: Sunday, 7:06 AM");
    mocks.create.mockResolvedValue({ session: { id: "live_1" }, transport: { type: "webrtc", sdp: "v=0 answer" } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("getLiveClientConfig", () => {
    it("is off unless enabled, and closes sessions after 30 s idle or 5 minutes", () => {
      mocks.providers = {};

      expect(getLiveClientConfig()).toEqual({ enabled: false, idleTimeout: 30, maxDuration: 300 });
    });

    it("keeps the timeouts within bounds", () => {
      mocks.providers = { live: { enabled: true, idleTimeout: 1, maxDuration: 99_999 } };

      expect(getLiveClientConfig()).toEqual({ enabled: true, idleTimeout: 5, maxDuration: 3600 });
    });
  });

  describe("buildLiveInstructions", () => {
    it("holds the character, the user's profile and the current information", async () => {
      const instructions = await buildLiveInstructions("default-user");

      expect(instructions).toMatch(/^You are .+\.\nYour name is "Mira"/);
      expect(instructions).toContain("\n\n[User Profile]\n- Name: Alex\n\n[Current Information]\nTime: Sunday, 7:06 AM");
      expect(mocks.getSimpleContext).toHaveBeenCalledWith("default-user");
    });

    it("uses the picked character, and no memories while memory is off", async () => {
      mocks.providers = { live: { enabled: true }, memory: { enabled: false } };

      const instructions = await buildLiveInstructions("default-user", "luna");

      expect(instructions).toContain('Your name is "Luna"');
      expect(instructions).not.toContain("[User Profile]");
      expect(mocks.getSimpleContext).not.toHaveBeenCalled();
    });

    it("still starts when the memories can't be read", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      mocks.getSimpleContext.mockRejectedValue(new Error("database locked"));

      expect(await buildLiveInstructions("default-user")).toContain("[Current Information]");
    });
  });

  describe("createLiveSession", () => {
    it("asks for gpt-live-1 over WebRTC, with gpt-6-luna behind it and a page that can only close it", async () => {
      const result = await createLiveSession({ sdp: "v=0 offer", userId: "default-user" });

      expect(result).toEqual({ sdp: "v=0 answer", sessionId: "live_1" });
      expect(mocks.clientOptions[0]).toEqual({ apiKey: "test-key", maxRetries: 0 });
      const [{ session, transport }] = mocks.create.mock.calls[0];
      expect(transport).toEqual({ type: "webrtc", sdp: "v=0 offer" });
      expect(session).toMatchObject({
        model: "gpt-live-1",
        audio: { output: { voice: "marin" } },
        delegation: { type: "responses", responses: { model: "gpt-6-luna", reasoning: { effort: "none" } } },
        client: { data_channel: { allowed_client_events: ["session.close"] } },
      });
      expect(session.instructions).toContain("[Current Information]");
      expect(session.delegation.responses.instructions).toBe(session.instructions);
      expect(session.client.data_channel.allowed_server_events.map((e: { type: string }) => e.type)).toEqual([
        "session.started",
        "session.input_transcript.delta",
        "session.output_transcript.delta",
        "session.usage.updated",
        "session.closed",
        "error",
      ]);
    });

    it("speaks each language with its own voice, unless the config names one", async () => {
      vi.stubEnv("LOCALE", "de");
      await createLiveSession({ sdp: "v=0 offer", userId: "default-user" });
      vi.stubEnv("LOCALE", "ja");
      await createLiveSession({ sdp: "v=0 offer", userId: "default-user" });
      mocks.providers = { live: { enabled: true, voice: "cedar", model: "gpt-live-2", backend: { model: "gpt-6-sol" } } };
      await createLiveSession({ sdp: "v=0 offer", userId: "default-user" });

      const sessions = mocks.create.mock.calls.map(([{ session }]) => session);
      expect(sessions.map((s) => s.audio.output.voice)).toEqual(["nuri", "harema", "cedar"]);
      expect(sessions[2]).toMatchObject({ model: "gpt-live-2", delegation: { responses: { model: "gpt-6-sol" } } });
    });

    it("says the key is missing, without asking OpenAI", async () => {
      vi.stubEnv("OPENAI_API_KEY", "");

      await expect(createLiveSession({ sdp: "v=0 offer", userId: "default-user" })).rejects.toEqual(
        new ServiceError("missing_key", "openai", "OPENAI_API_KEY is not configured")
      );
      expect(mocks.create).not.toHaveBeenCalled();
    });
  });
});
