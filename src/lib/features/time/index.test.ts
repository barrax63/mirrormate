import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TimeFeature } from "./index";

describe("TimeFeature", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T12:34:00Z"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("formats the time in English in English mode", async () => {
    vi.stubEnv("LOCALE", "en");
    const feature = new TimeFeature({ enabled: true, timezone: "America/New_York" });

    expect(await feature.getContext()).toBe("Current time: Sat, October 31, 2026 08:34 AM");
  });

  it("formats the time in Japanese in Japanese mode", async () => {
    vi.stubEnv("LOCALE", "ja");
    const feature = new TimeFeature({ enabled: true, timezone: "Asia/Tokyo" });

    expect(await feature.getContext()).toBe("現在時刻: 2026年10月31日（土） 21時34分");
  });

  it("returns nothing when disabled", async () => {
    vi.stubEnv("LOCALE", "en");
    const feature = new TimeFeature({ enabled: false });

    expect(await feature.getContext()).toBe("");
  });
});
