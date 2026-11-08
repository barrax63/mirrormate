import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { ServiceError } from "@/lib/errors/service-error";
import { consoleOutput } from "@/lib/testing/console";

const mocks = vi.hoisted(() => ({
  config: { enabled: true, idleTimeout: 30, maxDuration: 300 },
  createLiveSession: vi.fn(),
  processConversation: vi.fn(),
  memory: true,
}));

vi.mock("@/lib/live", () => ({
  getLiveClientConfig: () => mocks.config,
  createLiveSession: mocks.createLiveSession,
  getLiveMemoryService: () => (mocks.memory ? { processConversation: mocks.processConversation } : null),
}));

import { GET, POST } from "./route";
import { POST as postTranscript } from "./transcript/route";

const post = async (handler: typeof POST, body: unknown) => {
  const response = await handler(new NextRequest("http://localhost/api/live", { method: "POST", body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
};

describe("/api/live", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.config = { enabled: true, idleTimeout: 30, maxDuration: 300 };
    mocks.memory = true;
    mocks.createLiveSession.mockResolvedValue({ sdp: "v=0 answer", sessionId: "live_1" });
    mocks.processConversation.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tells the page whether live mode is on, and its timeouts", async () => {
    const response = await GET();

    expect(await response.json()).toEqual({ enabled: true, idleTimeout: 30, maxDuration: 300 });
  });

  it("creates a session for the page's offer, for the picked character", async () => {
    const { status, body } = await post(POST, { sdp: "v=0 offer", characterId: "luna" });

    expect(status).toBe(200);
    expect(body).toEqual({ sdp: "v=0 answer" });
    expect(mocks.createLiveSession).toHaveBeenCalledWith({ sdp: "v=0 offer", userId: "default-user", characterId: "luna" });
  });

  it("refuses while live mode is off, and an offer that isn't SDP", async () => {
    const bad = await post(POST, { sdp: "hello" });
    mocks.config = { ...mocks.config, enabled: false };
    const off = await post(POST, { sdp: "v=0 offer" });

    expect(bad).toMatchObject({ status: 400, body: { code: "failed" } });
    expect(off).toMatchObject({ status: 404, body: { code: "failed" } });
    expect(mocks.createLiveSession).not.toHaveBeenCalled();
  });

  it("says why OpenAI refused, as the other routes do", async () => {
    mocks.createLiveSession.mockRejectedValue(new ServiceError("invalid_key", "openai", "Incorrect API key provided"));

    const { status, body } = await post(POST, { sdp: "v=0 offer" });

    // A backend's refusal is a 502, as from /api/chat
    expect(status).toBe(502);
    expect(body).toMatchObject({ code: "invalid_key", service: "openai" });
  });

  describe("/transcript", () => {
    it("hands the last 10 turns to memory extraction, without logging them", async () => {
      const messages = Array.from({ length: 12 }, (_, i) => ({
        role: i % 2 ? "assistant" : "user",
        content: `secret turn ${i}`,
      }));

      const { status } = await post(postTranscript, { messages });

      expect(status).toBe(202);
      expect(mocks.processConversation).toHaveBeenCalledWith("default-user", messages.slice(-10));
      expect(consoleOutput()).toContain("[Live] Transcript of 12 turns, extracting memories");
      expect(consoleOutput()).not.toContain("secret");
    });

    it("skips extraction without a reply, or with memory off", async () => {
      await post(postTranscript, { messages: [{ role: "user", content: "hello?" }] });
      mocks.memory = false;
      await post(postTranscript, { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hi!" }] });

      expect(mocks.processConversation).not.toHaveBeenCalled();
    });

    it("refuses a transcript that isn't a list of turns", async () => {
      const { status, body } = await post(postTranscript, { messages: [{ role: "system", content: "x" }] });

      expect(status).toBe(400);
      expect(body.code).toBe("failed");
    });
  });
});
