import { google, calendar_v3 } from "googleapis";
import { getLocale, type Locale } from "@/lib/app";
import { localDateIn, midnightIn, parseLocalDate } from "./zones";

// For an event without a title, in the calendar context and the reminders
const UNTITLED: Record<Locale, string> = {
  en: "Untitled event",
  ja: "無題の予定",
  de: "Termin ohne Titel",
};

export interface CalendarEvent {
  summary: string;
  start: Date;
  end: Date;
  /** An event with a date but no time. It starts and ends at midnight in the timezone. */
  allDay: boolean;
}

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    throw new Error("Google Calendar credentials not configured");
  }

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
}

// An all-day event's date is a day in timeZone, so it starts at midnight there, not in UTC
function parseEventDate(
  eventDateTime: calendar_v3.Schema$EventDateTime | undefined,
  timeZone: string
): Date {
  if (!eventDateTime) {
    return new Date();
  }
  if (eventDateTime.dateTime) {
    return new Date(eventDateTime.dateTime);
  }
  if (eventDateTime.date) {
    return midnightIn(timeZone, parseLocalDate(eventDateTime.date));
  }
  return new Date();
}

function toCalendarEvent(event: calendar_v3.Schema$Event, timeZone: string): CalendarEvent {
  return {
    summary: event.summary || UNTITLED[getLocale()],
    start: parseEventDate(event.start, timeZone),
    end: parseEventDate(event.end, timeZone),
    allDay: !event.start?.dateTime && !!event.start?.date,
  };
}

/** Events on today's date in timeZone */
export async function fetchTodayEvents(
  calendarId: string,
  maxResults: number,
  timeZone: string
): Promise<CalendarEvent[]> {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const today = localDateIn(timeZone, new Date());
  const response = await calendar.events.list({
    calendarId,
    // Events that end after today starts, and start before tomorrow does
    timeMin: midnightIn(timeZone, today).toISOString(),
    timeMax: midnightIn(timeZone, { ...today, day: today.day + 1 }).toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  });

  return (response.data.items || []).map((event) => toCalendarEvent(event, timeZone));
}

export async function fetchUpcomingEvents(
  calendarId: string,
  maxResults: number,
  timeZone: string
): Promise<CalendarEvent[]> {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const now = new Date();

  const response = await calendar.events.list({
    calendarId,
    timeMin: now.toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  });

  return (response.data.items || []).map((event) => toCalendarEvent(event, timeZone));
}
