import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WeatherFeature } from "./index";

const mocks = vi.hoisted(() => ({ fetchWeather: vi.fn(), getTimezone: vi.fn() }));

vi.mock("./open-meteo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./open-meteo")>()),
  fetchWeather: mocks.fetchWeather,
}));

vi.mock("../config-loader", () => ({ getTimezone: mocks.getTimezone }));

const JAPANESE = /[぀-ヿ㐀-鿿]/;

const config = {
  enabled: true,
  provider: "open-meteo" as const,
  locations: [{ name: "New York", latitude: 40.7, longitude: -74 }],
  defaultLocation: "New York",
};

describe("WeatherFeature", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("LOCALE", "en");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.fetchWeather.mockResolvedValue({
      current_weather: { weathercode: 0, temperature: 21.4, windspeed: 9.6 },
    });
    mocks.getTimezone.mockReturnValue("America/New_York");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("reports the location, weather, temperature and wind speed", async () => {
    const context = await new WeatherFeature(config).getContext();

    expect(mocks.fetchWeather).toHaveBeenCalledWith(40.7, -74, "America/New_York");
    expect(context.split("\n")[0]).toBe("Current weather in New York: clear sky, 21°C, wind 10 km/h");
  });

  it("reports them in Japanese in Japanese mode", async () => {
    vi.stubEnv("LOCALE", "ja");

    const context = await new WeatherFeature({ ...config, locations: [{ ...config.locations[0], name: "東京" }], defaultLocation: "東京" }).getContext();

    expect(context.split("\n")[0]).toBe("現在の東京の天気: 快晴、気温21°C、風速10km/h");
  });

  // Without it, the LLM gave the current weather as tomorrow's
  it("says there's no forecast", async () => {
    const context = await new WeatherFeature(config).getContext();

    expect(context.split("\n").at(-1)).toBe("Forecast: none, so the weather later today and tomorrow is unknown.");
  });

  it("says there's no forecast in Japanese in Japanese mode", async () => {
    vi.stubEnv("LOCALE", "ja");

    const context = await new WeatherFeature(config).getContext();

    expect(context.split("\n").at(-1)).toBe("天気予報: なし。このあとや明日の天気はわかりません。");
  });

  it("serves repeat requests from the cache", async () => {
    const feature = new WeatherFeature(config);

    const first = await feature.getContext();
    const second = await feature.getContext();

    expect(second).toBe(first);
    expect(mocks.fetchWeather).toHaveBeenCalledOnce();
  });

  it("returns stale data when a refresh fails", async () => {
    vi.useFakeTimers();
    try {
      const feature = new WeatherFeature(config);
      const first = await feature.getContext();

      vi.advanceTimersByTime(11 * 60 * 1000);
      mocks.fetchWeather.mockRejectedValue(new Error("network down"));

      expect(await feature.getContext()).toBe(first);
      expect(mocks.fetchWeather).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns nothing when the first fetch fails", async () => {
    mocks.fetchWeather.mockRejectedValue(new Error("network down"));

    expect(await new WeatherFeature(config).getContext()).toBe("");
  });

  it("returns nothing for an unknown location", async () => {
    const feature = new WeatherFeature({ ...config, defaultLocation: "Atlantis" });

    expect(await feature.getContext()).toBe("");
    expect(mocks.fetchWeather).not.toHaveBeenCalled();
  });

  it("returns nothing when disabled", async () => {
    expect(await new WeatherFeature({ ...config, enabled: false }).getContext()).toBe("");
  });

  it("reports them in German in German mode", async () => {
    vi.stubEnv("LOCALE", "de");

    const context = await new WeatherFeature(config).getContext();

    expect(context).toBe(
      "Aktuelles Wetter in New York: klarer Himmel, 21 °C, Wind 10 km/h\nVorhersage: keine, daher ist das Wetter für später und morgen unbekannt."
    );
  });

  it("has no Japanese in English mode", async () => {
    expect(await new WeatherFeature(config).getContext()).not.toMatch(JAPANESE);
  });
});
