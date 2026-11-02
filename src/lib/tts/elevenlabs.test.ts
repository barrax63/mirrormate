import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Module = typeof import("./elevenlabs");

const page = (voices: [string, string][], next?: string) =>
  Response.json({
    voices: voices.map(([voice_id, name]) => ({ voice_id, name, category: "premade" })),
    has_more: !!next,
    next_page_token: next ?? null,
  });

describe("listVoices", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let listVoices: Module["listVoices"];

  beforeEach(async () => {
    // The list is kept per process, so each test starts from a fresh module
    vi.resetModules();
    ({ listVoices } = await import("./elevenlabs"));
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads every page and sorts the voices by name", async () => {
    fetchMock
      .mockResolvedValueOnce(page([["id-sarah", "Sarah - Confident"], ["id-adam", "Adam - Firm"]], "token-2"))
      .mockResolvedValueOnce(page([["id-lily", "Lily - Velvety"]]));

    const voices = await listVoices({ baseUrl: "http://127.0.0.1:9999/" });

    expect(voices).toEqual([
      { id: "id-adam", name: "Adam - Firm" },
      { id: "id-lily", name: "Lily - Velvety" },
      { id: "id-sarah", name: "Sarah - Confident" },
    ]);
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([
      "http://127.0.0.1:9999/v2/voices?page_size=100",
      "http://127.0.0.1:9999/v2/voices?page_size=100&next_page_token=token-2",
    ]);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "xi-api-key": "test-key" });
  });

  it("asks ElevenLabs once, however often it's called", async () => {
    fetchMock.mockResolvedValue(page([["id-sarah", "Sarah"]]));

    await Promise.all([listVoices(undefined), listVoices(undefined)]);
    await listVoices(undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.elevenlabs.io/v2/voices?page_size=100");
  });

  it("tries again after a failure, and says why it failed", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ detail: { status: "missing_permissions" } }, { status: 401 }))
      .mockResolvedValueOnce(page([["id-sarah", "Sarah"]]));

    await expect(listVoices(undefined)).rejects.toThrow("ElevenLabs returned 401 (missing_permissions)");
    expect(await listVoices(undefined)).toEqual([{ id: "id-sarah", name: "Sarah" }]);
  });

  it.each([
    [401, "invalid_api_key", "invalid_key"],
    [401, "missing_permissions", "missing_permissions"],
    [401, "quota_exceeded", "quota_exceeded"],
    [429, "too_many_concurrent_requests", "rate_limited"],
    [500, "internal_server_error", "failed"],
    [503, undefined, "unavailable"],
  ])("tells a %i with %s apart as %s", async (httpStatus, status, code) => {
    fetchMock.mockResolvedValue(Response.json(status ? { detail: { status } } : {}, { status: httpStatus }));

    await expect(listVoices(undefined)).rejects.toMatchObject({ code, service: "elevenlabs" });
  });

  it("fails without a key, without asking ElevenLabs", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");

    await expect(listVoices(undefined)).rejects.toThrow("ELEVENLABS_API_KEY is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
