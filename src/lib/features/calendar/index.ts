import { Feature, CalendarFeatureConfig } from "../types";
import { getTimezone } from "../config-loader";
import { fetchTodayEvents, fetchUpcomingEvents, CalendarEvent } from "./google-calendar";
import { getLocale, type Locale } from "@/lib/app";

// Cache settings
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CalendarText {
  /** The locale times are written in, and whether on a 12-hour clock */
  timeLocale: string;
  hour12: boolean;
  /** In place of a time, for an event with only a date */
  allDay: string;
  /** Each event is its start and summary */
  today(events: string[]): string;
  next(event: string, relative: string): string;
  inProgress: string;
  inMinutes(minutes: number): string;
  inHours(hours: number): string;
  // Said instead of nothing when there's no schedule to read. Otherwise the LLM guessed at one,
  // such as calling tomorrow clear.
  notConnected: string;
  notLoaded: string;
}

const TEXT: Record<Locale, CalendarText> = {
  en: {
    timeLocale: "en-US",
    hour12: true,
    allDay: "all day",
    today: (events) => `Today's schedule: ${events.length > 0 ? events.join(", ") : "none"}`,
    next: (event, relative) => `Next event: ${event}${relative ? ` (${relative})` : ""}`,
    inProgress: "in progress",
    inMinutes: (minutes) => `in ${minutes} min`,
    inHours: (hours) => `in ${hours} hr`,
    notConnected: "Calendar: not connected, so today's and tomorrow's schedules are unknown.",
    notLoaded: "Calendar: couldn't be loaded, so today's and tomorrow's schedules are unknown.",
  },
  ja: {
    timeLocale: "ja-JP",
    hour12: false,
    allDay: "終日",
    today: (events) => `今日の予定: ${events.length > 0 ? events.join("、") : "なし"}`,
    next: (event, relative) => `次の予定: ${event}${relative ? `（${relative}）` : ""}`,
    inProgress: "進行中",
    inMinutes: (minutes) => `あと${minutes}分`,
    inHours: (hours) => `あと${hours}時間`,
    notConnected: "カレンダー: 未接続のため、今日と明日の予定はわかりません。",
    notLoaded: "カレンダー: 読み込めなかったため、今日と明日の予定はわかりません。",
  },
  de: {
    timeLocale: "de-DE",
    hour12: false,
    allDay: "ganztägig",
    today: (events) => `Heutige Termine: ${events.length > 0 ? events.join(", ") : "keine"}`,
    next: (event, relative) => `Nächster Termin: ${event}${relative ? ` (${relative})` : ""}`,
    inProgress: "läuft gerade",
    inMinutes: (minutes) => `in ${minutes} Min.`,
    inHours: (hours) => `in ${hours} Std.`,
    notConnected: "Kalender: nicht verbunden, daher sind die heutigen und morgigen Termine unbekannt.",
    notLoaded: "Kalender: konnte nicht geladen werden, daher sind die heutigen und morgigen Termine unbekannt.",
  },
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

  // Its start and summary. Times are in the timezone the app tells times in: the server's can
  // differ, and is UTC in Docker.
  private formatEvent(event: CalendarEvent, text: CalendarText): string {
    const start = event.allDay
      ? text.allDay
      : event.start.toLocaleTimeString(text.timeLocale, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: text.hour12,
          timeZone: getTimezone(),
        });
    return `${start} ${event.summary}`;
  }

  private formatRelativeTime(date: Date, text: CalendarText): string {
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffMins = Math.round(diffMs / 60000);

    if (diffMins < 0) {
      return text.inProgress;
    }
    if (diffMins < 60) {
      return text.inMinutes(diffMins);
    }
    const diffHours = Math.round(diffMins / 60);
    if (diffHours < 24) {
      return text.inHours(diffHours);
    }
    return "";
  }

  private formatTodayEvents(events: CalendarEvent[], text: CalendarText): string {
    return text.today(events.map((e) => this.formatEvent(e, text)));
  }

  private formatNextEvent(events: CalendarEvent[], text: CalendarText): string {
    if (events.length === 0) {
      return "";
    }

    const next = events[0];
    return text.next(this.formatEvent(next, text), this.formatRelativeTime(next.start, text));
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
      return TEXT[getLocale()].notConnected;
    }

    try {
      const timeZone = getTimezone();
      const [todayEvents, upcomingEvents] = await Promise.all([
        fetchTodayEvents(calendarId, this.config.maxResults, timeZone),
        fetchUpcomingEvents(calendarId, 1, timeZone),
      ]);

      console.log("[Calendar] Fetched:", todayEvents.length, "today,", upcomingEvents.length, "upcoming");

      const text = TEXT[getLocale()];
      const parts: string[] = [];
      parts.push(this.formatTodayEvents(todayEvents, text));

      const nextEventStr = this.formatNextEvent(upcomingEvents, text);
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
      return TEXT[getLocale()].notLoaded;
    }
  }
}
