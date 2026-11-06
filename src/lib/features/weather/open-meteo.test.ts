import { describe, it, expect } from "vitest";
import { getWeatherDescription } from "./open-meteo";

describe("getWeatherDescription", () => {
  it.each([
    [0, "clear sky", "快晴", "klarer Himmel"],
    [1, "mainly clear", "晴れ", "überwiegend klar"],
    [3, "overcast", "曇り", "bedeckt"],
    [63, "rain", "雨", "Regen"],
    [73, "snow", "雪", "Schneefall"],
    [95, "thunderstorm", "雷雨", "Gewitter"],
  ])("describes code %i in the locale's language", (code, en, ja, de) => {
    expect(getWeatherDescription(code, "en")).toBe(en);
    expect(getWeatherDescription(code, "ja")).toBe(ja);
    expect(getWeatherDescription(code, "de")).toBe(de);
  });

  it("says unknown for a code it doesn't know", () => {
    expect(getWeatherDescription(999, "en")).toBe("unknown");
    expect(getWeatherDescription(999, "ja")).toBe("不明");
    expect(getWeatherDescription(999, "de")).toBe("unbekannt");
  });
});
