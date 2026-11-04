import { Feature, CalendarFeatureConfig } from "../types";
import { getTimezone } from "../config-loader";
import { fetchTodayEvents, fetchUpcomingEvents, CalendarEvent } from "./google-calendar";
import { getLocale, type Locale } from "@/lib/app";

// Cache settings
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Said instead of nothing when there's no schedule to read. Otherwise the LLM guessed at one,
// such as calling tomorrow clear.
const NOT_CONNECTED: Record<Locale, string> = {
  en: "Calendar: not connected, so today's and tomorrow's schedules are unknown.",
  ja: "カレンダー: 未接続のため、今日と明日の予定はわかりません。",
};
const NOT_LOADED: Record<Locale, string> = {
  en: "Calendar: couldn't be loaded, so today's and tomorrow's schedules are unknown.",
  ja: "カレンダー: 読み込めなかったため、今日と明日の予定はわかりません。",
};
// In place of a time, for an event with only a date
const ALL_DAY: Record<Locale, string> = {
  en: "all day",
  ja: "終日",
};

interface CacheEntry {
  data: string;
  timestamp: number;
}

export class CalendarFeature implements Feature {
  name = "calendar";
  private config: CalendarFeatureConfig;
  private cache: CacheEntry | null = null;

  constructor(config: CalendarFeatureConfig) {
    this.config = config;
  }

  private isCacheValid(): boolean {
    if (!this.cache) return false;
    return Date.now() - this.cache.timestamp < CACHE_TTL_MS;
  }

  private isJapanese(): boolean {
    return getLocale() === "ja";
  }

  // In the timezone the app tells times in. The server's can differ, and is UTC in Docker.
  private formatStart(event: CalendarEvent): string {
    if (event.allDay) {
      return ALL_DAY[getLocale()];
    }
    const isJa = this.isJapanese();
    return event.start.toLocaleTimeString(isJa ? "ja-JP" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: !isJa,
      timeZone: getTimezone(),
    });
  }

  private formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffMins = Math.round(diffMs / 60000);
    const isJa = this.isJapanese();

    if (diffMins < 0) {
      return isJa ? "進行中" : "in progress";
    }
    if (diffMins < 60) {
      return isJa ? `あと${diffMins}分` : `in ${diffMins} min`;
    }
    const diffHours = Math.round(diffMins / 60);
    if (diffHours < 24) {
      return isJa ? `あと${diffHours}時間` : `in ${diffHours} hr`;
    }
    return "";
  }

  private formatTodayEvents(events: CalendarEvent[]): string {
    const isJa = this.isJapanese();
    if (events.length === 0) {
      return isJa ? "今日の予定: なし" : "Today's schedule: none";
    }

    const separator = isJa ? "、" : ", ";
    const formatted = events
      .map((e) => `${this.formatStart(e)} ${e.summary}`)
      .join(separator);
    return isJa ? `今日の予定: ${formatted}` : `Today's schedule: ${formatted}`;
  }

  private formatNextEvent(events: CalendarEvent[]): string {
    if (events.length === 0) {
      return "";
    }

    const isJa = this.isJapanese();
    const next = events[0];
    const relative = this.formatRelativeTime(next.start);
    const relativeStr = relative ? (isJa ? `（${relative}）` : ` (${relative})`) : "";
    const label = isJa ? "次の予定" : "Next event";
    return `${label}: ${this.formatStart(next)} ${next.summary}${relativeStr}`;
  }

  async getContext(): Promise<string> {
    if (!this.config.enabled) {
      return "";
    }

    // Return cached data if valid
    if (this.isCacheValid()) {
      console.log("[Calendar] Using cached data");
      return this.cache!.data;
    }

    console.log("[Calendar] Cache expired or empty, fetching fresh data...");

    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    if (
      !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
      !process.env.GOOGLE_PRIVATE_KEY ||
      !calendarId
    ) {
      return NOT_CONNECTED[getLocale()];
    }

    try {
      const timeZone = getTimezone();
      const [todayEvents, upcomingEvents] = await Promise.all([
        fetchTodayEvents(calendarId, this.config.maxResults, timeZone),
        fetchUpcomingEvents(calendarId, 1, timeZone),
      ]);

      console.log("[Calendar] Fetched:", todayEvents.length, "today,", upcomingEvents.length, "upcoming");

      const parts: string[] = [];
      parts.push(this.formatTodayEvents(todayEvents));

      const nextEventStr = this.formatNextEvent(upcomingEvents);
      if (nextEventStr) {
        parts.push(nextEventStr);
      }

      const result = parts.join("\n");

      // Update cache
      this.cache = {
        data: result,
        timestamp: Date.now(),
      };

      return result;
    } catch (error) {
      console.error("[Calendar] Failed to fetch calendar events:", error);
      // Return stale cache if available
      if (this.cache) {
        console.log("[Calendar] Returning stale cache due to error");
        return this.cache.data;
      }
      return NOT_LOADED[getLocale()];
    }
  }
}
