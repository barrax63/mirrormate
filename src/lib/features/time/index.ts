import { Feature, TimeFeatureConfig } from "../types";
import { getLocale, type Locale } from "@/lib/app";

type Part = (type: Intl.DateTimeFormatPartTypes) => string;

interface TimeText {
  /** The locale the date is written in, and whether on a 12-hour clock */
  dateLocale: string;
  hour12: boolean;
  /** The date and time, from the parts of the date in that locale */
  format(part: Part): string;
  label: string;
}

const TEXT: Record<Locale, TimeText> = {
  en: {
    dateLocale: "en-US",
    hour12: true,
    format: (part) =>
      `${part("weekday")}, ${part("month")} ${part("day")}, ${part("year")} ${part("hour")}:${part("minute")} ${part("dayPeriod")}`,
    label: "Current time",
  },
  ja: {
    dateLocale: "ja-JP",
    hour12: false,
    format: (part) =>
      `${part("year")}年${part("month")}月${part("day")}日（${part("weekday")}） ${part("hour")}時${part("minute")}分`,
    label: "現在時刻",
  },
  de: {
    dateLocale: "de-DE",
    hour12: false,
    format: (part) =>
      `${part("weekday")}, ${part("day")}. ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")} Uhr`,
    label: "Aktuelle Uhrzeit",
  },
};

export class TimeFeature implements Feature {
  name = "time";
  private config: TimeFeatureConfig;

  constructor(config: TimeFeatureConfig) {
    this.config = config;
  }

  async getContext(): Promise<string> {
    if (!this.config.enabled) {
      return "";
    }

    const now = new Date();
    const timezone = this.config.timezone || "Asia/Tokyo";
    const text = TEXT[getLocale()];

    // Format date and time in the specified timezone
    const formatter = new Intl.DateTimeFormat(text.dateLocale, {
      timeZone: timezone,
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: text.hour12,
    });

    const parts = formatter.formatToParts(now);
    const dateAndTime = text.format((type) => parts.find((p) => p.type === type)?.value || "");

    console.log(`[Time] Current time: ${dateAndTime}`);

    return `${text.label}: ${dateAndTime}`;
  }
}
