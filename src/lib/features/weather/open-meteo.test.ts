import { describe, it, expect } from "vitest";
import { getWeatherDescription } from "./open-meteo";

describe("getWeatherDescription", () => {
  it.each([
    [0, "clear sky", "快晴"],
    [1, "mainly clear", "晴れ"],
    [3, "overcast", "曇り"],
    [63, "rain", "雨"],
    [73, "snow", "雪"],
    [95, "thunderstorm", "雷雨"],
  ])("describes code %i in the locale's language", (code, en, ja) => {
    expect(getWeatherDescription(code, "en")).toBe(en);
    expect(getWeatherDescription(code, "ja")).toBe(ja);
  });

  it("says unknown for a code it doesn't know", () => {
    expect(getWeatherDescription(999, "en")).toBe("unknown");
    expect(getWeatherDescription(999, "ja")).toBe("不明");
  });
});
