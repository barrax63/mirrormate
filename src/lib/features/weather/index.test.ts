import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WeatherFeature } from "./index";

const mocks = vi.hoisted(() => ({ fetchWeather: vi.fn() }));

vi.mock("./open-meteo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./open-meteo")>()),
  fetchWeather: mocks.fetchWeather,
}));

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("reports the location, temperature and wind speed", async () => {
    const context = await new WeatherFeature(config).getContext();

    expect(mocks.fetchWeather).toHaveBeenCalledWith(40.7, -74);
    expect(context).toContain("New York");
    expect(context).toContain("21°C");
    expect(context).toContain("10km/h");
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

  // Known bug: the sentence and weather descriptions are always Japanese. Remove
  // .fails when they follow the locale.
  it.fails("has no Japanese in English mode", async () => {
    expect(await new WeatherFeature(config).getContext()).not.toMatch(JAPANESE);
  });
});
