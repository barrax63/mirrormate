import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  loadProvidersConfig: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/providers/config-loader", () => ({
  loadProvidersConfig: mocks.loadProvidersConfig,
}));

function useTTS(tts?: Record<string, unknown>) {
  mocks.loadProvidersConfig.mockReturnValue({ providers: { tts } });
}

// The route caches the voices in its module, so each request gets a fresh copy
async function getSpeakers() {
  vi.resetModules();
  const { GET } = await import("./route");
  return GET();
}

describe("GET /api/voicevox/speakers", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("offers no voices when replies use OpenAI, without contacting VOICEVOX", async () => {
    useTTS({ provider: "openai", voicevox: { baseUrl: "http://voicevox" } });

    const response = await getSpeakers();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ speakers: [], enabled: false });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("offers no voices without a TTS config, which means OpenAI", async () => {
    useTTS(undefined);

    const response = await getSpeakers();

    expect(await response.json()).toEqual({ speakers: [], enabled: false });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("lists each style as a voice when replies use VOICEVOX", async () => {
    useTTS({ provider: "voicevox", voicevox: { baseUrl: "http://voicevox" } });
    mocks.fetch.mockResolvedValue(
      Response.json([
        { name: "Mock", speaker_uuid: "mock", styles: [{ name: "normal", id: 2 }, { name: "happy", id: 5 }] },
      ])
    );

    const response = await getSpeakers();

    expect(mocks.fetch.mock.calls[0][0]).toBe("http://voicevox/speakers");
    expect(await response.json()).toEqual({
      speakers: [
        { id: 5, name: "Mock", styleName: "happy" },
        { id: 2, name: "Mock", styleName: "normal" },
      ],
    });
  });

  it("reports an error when replies use VOICEVOX and it can't be reached", async () => {
    useTTS({ provider: "voicevox", voicevox: { baseUrl: "http://voicevox" } });
    mocks.fetch.mockRejectedValue(new TypeError("fetch failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await getSpeakers();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ speakers: [], error: "VOICEVOX unavailable" });
  });
});
