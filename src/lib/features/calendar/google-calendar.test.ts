import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchTodayEvents, fetchUpcomingEvents } from "./google-calendar";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: class {} },
    calendar: () => ({ events: { list: mocks.list } }),
  },
}));

describe("Google Calendar", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    // A server in UTC, as in Docker
    vi.stubEnv("TZ", "UTC");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "mirror@example.iam.gserviceaccount.com");
    vi.stubEnv("GOOGLE_PRIVATE_KEY", "test-key");
    mocks.list.mockResolvedValue({ data: { items: [] } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("asks for today in the timezone, not the server's", async () => {
    // Already Thursday in Tokyo, still Wednesday in UTC
    vi.setSystemTime(new Date("2026-11-04T23:30:00Z"));

    await fetchTodayEvents("me@example.com", 5, "Asia/Tokyo");

    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        timeMin: "2026-11-04T15:00:00.000Z",
        timeMax: "2026-11-05T15:00:00.000Z",
      })
    );
  });

  it("starts an all-day event at midnight in the timezone", async () => {
    vi.setSystemTime(new Date("2026-11-04T23:30:00Z"));
    mocks.list.mockResolvedValue({
      data: {
        items: [
          { summary: "Holiday", start: { date: "2026-11-05" }, end: { date: "2026-11-06" } },
          {
            summary: "Dentist",
            start: { dateTime: "2026-11-05T10:00:00+09:00" },
            end: { dateTime: "2026-11-05T11:00:00+09:00" },
          },
        ],
      },
    });

    const [holiday, dentist] = await fetchTodayEvents("me@example.com", 5, "Asia/Tokyo");

    expect(holiday).toEqual({
      summary: "Holiday",
      start: new Date("2026-11-04T15:00:00Z"),
      end: new Date("2026-11-05T15:00:00Z"),
      allDay: true,
    });
    expect(dentist).toEqual({
      summary: "Dentist",
      start: new Date("2026-11-05T01:00:00Z"),
      end: new Date("2026-11-05T02:00:00Z"),
      allDay: false,
    });
  });

  it("names an event without a title in the locale's language", async () => {
    mocks.list.mockResolvedValue({
      data: { items: [{ start: { dateTime: "2026-11-05T10:00:00Z" }, end: { dateTime: "2026-11-05T11:00:00Z" } }] },
    });

    vi.stubEnv("LOCALE", "en");
    const [english] = await fetchUpcomingEvents("me@example.com", 5, "UTC");
    vi.stubEnv("LOCALE", "ja");
    const [japanese] = await fetchUpcomingEvents("me@example.com", 5, "UTC");

    expect(english.summary).toBe("Untitled event");
    expect(japanese.summary).toBe("無題の予定");
  });

  it("marks all-day events among the upcoming ones", async () => {
    vi.setSystemTime(new Date("2026-11-04T23:30:00Z"));
    mocks.list.mockResolvedValue({
      data: { items: [{ summary: "Holiday", start: { date: "2026-11-05" }, end: { date: "2026-11-06" } }] },
    });

    const [holiday] = await fetchUpcomingEvents("me@example.com", 5, "Europe/Berlin");

    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ timeMin: "2026-11-04T23:30:00.000Z" }));
    expect(holiday).toMatchObject({ start: new Date("2026-11-04T23:00:00Z"), allDay: true });
  });
});
