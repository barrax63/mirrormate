import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeModule } from "./modules";
import { clearFeaturesConfigCache } from "../features/config-loader";
import { clearPresetCache } from "../presets";

describe("today_info", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    // A server in UTC, as in Docker
    vi.stubEnv("TZ", "UTC");
    vi.spyOn(console, "log").mockImplementation(() => {});
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ events: [{ year: 2022, text: "Something happened" }] }))
    );
    vi.stubGlobal("fetch", fetchMock);
    clearFeaturesConfigCache();
    clearPresetCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearFeaturesConfigCache();
    clearPresetCache();
  });

  it("uses the date in the English preset's timezone, not the server's", async () => {
    vi.stubEnv("LOCALE", "en");
    // Monday in UTC, but still Sunday evening in Los Angeles
    vi.setSystemTime(new Date("2026-11-02T07:47:00Z"));

    const result = await executeModule({ module: "today_info" });

    expect(fetchMock.mock.calls[0][0]).toBe("https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/11/1");
    expect(result.content).toBe('Today, November 1, is the day when "Something happened" happened in 2022.');
  });

  it("uses the date in the Japanese preset's timezone, not the server's", async () => {
    vi.stubEnv("LOCALE", "ja");
    // Sunday in UTC, but already Monday morning in Tokyo
    vi.setSystemTime(new Date("2026-11-01T20:00:00Z"));

    const result = await executeModule({ module: "today_info" });

    expect(fetchMock.mock.calls[0][0]).toBe("https://ja.wikipedia.org/api/rest_v1/feed/onthisday/events/11/2");
    expect(result.content).toBe("今日11月2日は、2022年に「Something happened」があった日です。");
  });
});
