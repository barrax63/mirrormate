import { Feature, WeatherFeatureConfig } from "../types";
import { getTimezone } from "../config-loader";
import { fetchWeather, getWeatherDescription } from "./open-meteo";
import { getLocale, type Locale } from "@/lib/app";

// Cache settings
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CurrentWeather {
  location: string;
  description: string;
  temperature: number;
  windSpeed: number;
}

interface WeatherText {
  current(weather: CurrentWeather): string;
  /** Only the current weather is fetched. Said, or the LLM passes it off as tomorrow's. */
  noForecast: string;
}

const TEXT: Record<Locale, WeatherText> = {
  en: {
    current: (w) => `Current weather in ${w.location}: ${w.description}, ${w.temperature}°C, wind ${w.windSpeed} km/h`,
    noForecast: "Forecast: none, so the weather later today and tomorrow is unknown.",
  },
  ja: {
    current: (w) => `現在の${w.location}の天気: ${w.description}、気温${w.temperature}°C、風速${w.windSpeed}km/h`,
    noForecast: "天気予報: なし。このあとや明日の天気はわかりません。",
  },
  de: {
    current: (w) => `Aktuelles Wetter in ${w.location}: ${w.description}, ${w.temperature} °C, Wind ${w.windSpeed} km/h`,
    noForecast: "Vorhersage: keine, daher ist das Wetter für später und morgen unbekannt.",
  },
};

interface CacheEntry {
  data: string;
  timestamp: number;
}

export class WeatherFeature implements Feature {
  name = "weather";
  private config: WeatherFeatureConfig;
  private cache: CacheEntry | null = null;

  constructor(config: WeatherFeatureConfig) {
    this.config = config;
  }

  private isCacheValid(): boolean {
    if (!this.cache) return false;
    return Date.now() - this.cache.timestamp < CACHE_TTL_MS;
  }

  async getContext(): Promise<string> {
    if (!this.config.enabled) {
      return "";
    }

    // Return cached data if valid
    if (this.isCacheValid()) {
      console.log("[Weather] Using cached data");
      return this.cache!.data;
    }

    console.log("[Weather] Cache expired or empty, fetching fresh data...");

    const location = this.config.locations.find(
      (loc) => loc.name === this.config.defaultLocation
    );

    if (!location) {
      console.warn(`[Weather] Location not found: ${this.config.defaultLocation}`);
      return "";
    }

    try {
      const weather = await fetchWeather(location.latitude, location.longitude, getTimezone());
      const locale = getLocale();
      const text = TEXT[locale];
      const description = getWeatherDescription(weather.current_weather.weathercode, locale);
      const temperature = Math.round(weather.current_weather.temperature);
      const windSpeed = Math.round(weather.current_weather.windspeed);

      console.log("[Weather] Fetched:", description, temperature + "°C");

      const current = text.current({ location: location.name, description, temperature, windSpeed });
      const result = `${current}\n${text.noForecast}`;

      // Update cache
      this.cache = {
        data: result,
        timestamp: Date.now(),
      };

      return result;
    } catch (error) {
      console.error("[Weather] Failed to fetch weather:", error);
      // Return stale cache if available
      if (this.cache) {
        console.log("[Weather] Returning stale cache due to error");
        return this.cache.data;
      }
      return "";
    }
  }
}
