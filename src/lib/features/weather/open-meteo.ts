import https from "https";
import dns from "dns";
import type { Locale } from "@/lib/app";

// Force IPv4 first to avoid ETIMEDOUT on some networks
dns.setDefaultResultOrder("ipv4first");

export interface OpenMeteoResponse {
  current_weather: {
    temperature: number;
    weathercode: number;
    windspeed: number;
    winddirection: number;
    is_day: number;
    time: string;
  };
}

// The WMO weather codes Open-Meteo reports
const WEATHER_CODES: Record<Locale, Record<number, string>> = {
  en: {
    0: "clear sky",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "rime fog",
    51: "light drizzle",
    53: "drizzle",
    55: "heavy drizzle",
    56: "freezing drizzle",
    57: "heavy freezing drizzle",
    61: "light rain",
    63: "rain",
    65: "heavy rain",
    66: "freezing rain",
    67: "heavy freezing rain",
    71: "light snow",
    73: "snow",
    75: "heavy snow",
    77: "snow grains",
    80: "light rain showers",
    81: "rain showers",
    82: "violent rain showers",
    85: "light snow showers",
    86: "heavy snow showers",
    95: "thunderstorm",
    96: "thunderstorm with light hail",
    99: "thunderstorm with heavy hail",
  },
  ja: {
    0: "快晴",
    1: "晴れ",
    2: "一部曇り",
    3: "曇り",
    45: "霧",
    48: "霧氷",
    51: "小雨",
    53: "雨",
    55: "強い雨",
    56: "凍雨",
    57: "強い凍雨",
    61: "小雨",
    63: "雨",
    65: "大雨",
    66: "凍雨",
    67: "強い凍雨",
    71: "小雪",
    73: "雪",
    75: "大雪",
    77: "霧雪",
    80: "にわか雨",
    81: "にわか雨",
    82: "激しいにわか雨",
    85: "にわか雪",
    86: "激しいにわか雪",
    95: "雷雨",
    96: "雹を伴う雷雨",
    99: "激しい雹を伴う雷雨",
  },
  de: {
    0: "klarer Himmel",
    1: "überwiegend klar",
    2: "teilweise bewölkt",
    3: "bedeckt",
    45: "Nebel",
    48: "Nebel mit Raureif",
    51: "leichter Nieselregen",
    53: "Nieselregen",
    55: "starker Nieselregen",
    56: "gefrierender Nieselregen",
    57: "starker gefrierender Nieselregen",
    61: "leichter Regen",
    63: "Regen",
    65: "starker Regen",
    66: "gefrierender Regen",
    67: "starker gefrierender Regen",
    71: "leichter Schneefall",
    73: "Schneefall",
    75: "starker Schneefall",
    77: "Schneegriesel",
    80: "leichte Regenschauer",
    81: "Regenschauer",
    82: "heftige Regenschauer",
    85: "leichte Schneeschauer",
    86: "starke Schneeschauer",
    95: "Gewitter",
    96: "Gewitter mit leichtem Hagel",
    99: "Gewitter mit starkem Hagel",
  },
};

const UNKNOWN: Record<Locale, string> = {
  en: "unknown",
  ja: "不明",
  de: "unbekannt",
};

export function getWeatherDescription(code: number, locale: Locale): string {
  return WEATHER_CODES[locale][code] || UNKNOWN[locale];
}

async function fetchWeatherOnce(
  url: string,
  timeoutMs: number
): Promise<OpenMeteoResponse> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Weather API error: ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error("Failed to parse weather response"));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Weather API timeout"));
    });
  });
}

/** The weather now, with its times and any day boundaries in timeZone */
export async function fetchWeather(
  latitude: number,
  longitude: number,
  timeZone: string,
  timeoutMs: number = 10000,
  retries: number = 2
): Promise<OpenMeteoResponse> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude.toString());
  url.searchParams.set("longitude", longitude.toString());
  url.searchParams.set("current_weather", "true");
  url.searchParams.set("timezone", timeZone);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchWeatherOnce(url.toString(), timeoutMs);
    } catch (error) {
      lastError = error as Error;
      console.log(`[Weather] Attempt ${attempt + 1} failed: ${lastError.message}`);
      if (attempt < retries) {
        // Wait before retry (1s, 2s, ...)
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}
