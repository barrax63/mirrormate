import { describe, it, expect } from "vitest";
import { localDateIn, midnightIn, parseLocalDate } from "./zones";

describe("localDateIn", () => {
  it("gives the date in the timezone, not in UTC", () => {
    const at = new Date("2026-11-04T23:30:00Z");

    expect(localDateIn("UTC", at)).toEqual({ year: 2026, month: 11, day: 4 });
    expect(localDateIn("Asia/Tokyo", at)).toEqual({ year: 2026, month: 11, day: 5 });
    expect(localDateIn("America/Los_Angeles", at)).toEqual({ year: 2026, month: 11, day: 4 });
  });
});

describe("midnightIn", () => {
  it("gives the moment the day starts in the timezone", () => {
    const day = { year: 2026, month: 11, day: 5 };

    expect(midnightIn("Asia/Tokyo", day).toISOString()).toBe("2026-11-04T15:00:00.000Z");
    expect(midnightIn("Europe/Berlin", day).toISOString()).toBe("2026-11-04T23:00:00.000Z");
    expect(midnightIn("America/Los_Angeles", day).toISOString()).toBe("2026-11-05T08:00:00.000Z");
    expect(midnightIn("UTC", day).toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });

  it("follows summer time changing during the night before", () => {
    // Berlin moves to summer time at 02:00 on March 29, and back at 03:00 on October 25
    expect(midnightIn("Europe/Berlin", { year: 2026, month: 3, day: 29 }).toISOString()).toBe(
      "2026-03-28T23:00:00.000Z"
    );
    expect(midnightIn("Europe/Berlin", { year: 2026, month: 3, day: 30 }).toISOString()).toBe(
      "2026-03-29T22:00:00.000Z"
    );
    expect(midnightIn("Europe/Berlin", { year: 2026, month: 10, day: 26 }).toISOString()).toBe(
      "2026-10-25T23:00:00.000Z"
    );
    // Los Angeles goes back at 02:00 on November 1
    expect(midnightIn("America/Los_Angeles", { year: 2026, month: 11, day: 1 }).toISOString()).toBe(
      "2026-11-01T07:00:00.000Z"
    );
    expect(midnightIn("America/Los_Angeles", { year: 2026, month: 11, day: 2 }).toISOString()).toBe(
      "2026-11-02T08:00:00.000Z"
    );
  });

  it("rolls a day past the end of the month over into the next", () => {
    expect(midnightIn("Asia/Tokyo", { year: 2026, month: 12, day: 32 }).toISOString()).toBe(
      "2026-12-31T15:00:00.000Z"
    );
  });
});

describe("parseLocalDate", () => {
  it("reads a YYYY-MM-DD date", () => {
    expect(parseLocalDate("2026-11-05")).toEqual({ year: 2026, month: 11, day: 5 });
  });
});
