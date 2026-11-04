// Calendar days in a given timezone. The server's own timezone can differ, and is UTC in Docker.

export interface LocalDate {
  year: number;
  /** 1 to 12 */
  month: number;
  day: number;
}

function partsIn(timeZone: string, at: Date): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);
  return Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])
  );
}

/** The date it is in timeZone at that moment */
export function localDateIn(timeZone: string, at: Date): LocalDate {
  const { year, month, day } = partsIn(timeZone, at);
  return { year, month, day };
}

/** How far timeZone is ahead of UTC at that moment, in ms */
function offsetAt(timeZone: string, at: number): number {
  const { year, month, day, hour, minute, second } = partsIn(timeZone, new Date(at));
  return Date.UTC(year, month - 1, day, hour, minute, second) - Math.floor(at / 1000) * 1000;
}

/**
 * The moment a day starts in timeZone. A day past the end of the month rolls over, so
 * day + 1 gives the start of the next day.
 */
export function midnightIn(timeZone: string, { year, month, day }: LocalDate): Date {
  const asUtc = Date.UTC(year, month - 1, day);
  const first = asUtc - offsetAt(timeZone, asUtc);
  // Across a change to or from summer time, the offset at midnight itself can differ
  return new Date(asUtc - offsetAt(timeZone, first));
}

/** A date written as YYYY-MM-DD, as Google Calendar gives all-day events */
export function parseLocalDate(text: string): LocalDate {
  const [year, month, day] = text.split("-").map(Number);
  return { year, month, day };
}
