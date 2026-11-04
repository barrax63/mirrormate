import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CalendarFeature } from "./index";

const mocks = vi.hoisted(() => ({
  fetchTodayEvents: vi.fn(),
  fetchUpcomingEvents: vi.fn(),
  getTimezone: vi.fn(),
}));

vi.mock("./google-calendar", () => ({
  fetchTodayEvents: mocks.fetchTodayEvents,
  fetchUpcomingEvents: mocks.fetchUpcomingEvents,
}));

vi.mock("../config-loader", () => ({ getTimezone: mocks.getTimezone }));

const config = { enabled: true, maxResults: 5 };

function connect() {
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "mirror@example.iam.gserviceaccount.com");
  vi.stubEnv("GOOGLE_PRIVATE_KEY", "test-key");
  vi.stubEnv("GOOGLE_CALENDAR_ID", "me@example.com");
}

describe("CalendarFeature", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("LOCALE", "en");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "");
    vi.stubEnv("GOOGLE_PRIVATE_KEY", "");
    vi.stubEnv("GOOGLE_CALENDAR_ID", "");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.fetchTodayEvents.mockResolvedValue([]);
    mocks.fetchUpcomingEvents.mockResolvedValue([]);
    mocks.getTimezone.mockReturnValue("Europe/Berlin");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // Without it, the LLM called tomorrow's schedule clear when asked about it
  it("says the schedule is unknown when no calendar is connected", async () => {
    const context = await new CalendarFeature(config).getContext();

    expect(context).toBe("Calendar: not connected, so today's and tomorrow's schedules are unknown.");
    expect(mocks.fetchTodayEvents).not.toHaveBeenCalled();
  });

  it("says so in Japanese in Japanese mode", async () => {
    vi.stubEnv("LOCALE", "ja");

    expect(await new CalendarFeature(config).getContext()).toBe(
      "カレンダー: 未接続のため、今日と明日の予定はわかりません。"
    );
  });

  it("says the schedule is unknown when the calendar can't be loaded", async () => {
    connect();
    mocks.fetchTodayEvents.mockRejectedValue(new Error("invalid_grant"));

    expect(await new CalendarFeature(config).getContext()).toBe(
      "Calendar: couldn't be loaded, so today's and tomorrow's schedules are unknown."
    );
  });

  it("tells a day without events apart from an unknown schedule", async () => {
    connect();

    expect(await new CalendarFeature(config).getContext()).toBe("Today's schedule: none");
  });

  describe("with events", () => {
    const dentist = {
      summary: "Dentist",
      start: new Date("2026-11-05T09:00:00Z"),
      end: new Date("2026-11-05T10:00:00Z"),
      allDay: false,
    };
    const holiday = {
      summary: "Holiday",
      start: new Date("2026-11-04T23:00:00Z"),
      end: new Date("2026-11-05T23:00:00Z"),
      allDay: true,
    };

    beforeEach(() => {
      connect();
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-05T08:30:00Z"));
      // A server in UTC, as in Docker
      vi.stubEnv("TZ", "UTC");
    });

    it("tells the times in the app's timezone, not the server's", async () => {
      mocks.fetchTodayEvents.mockResolvedValue([dentist]);
      mocks.fetchUpcomingEvents.mockResolvedValue([dentist]);

      const context = await new CalendarFeature(config).getContext();

      expect(context).toBe("Today's schedule: 10:00 AM Dentist\nNext event: 10:00 AM Dentist (in 30 min)");
      expect(mocks.fetchTodayEvents).toHaveBeenCalledWith("me@example.com", 5, "Europe/Berlin");
      expect(mocks.fetchUpcomingEvents).toHaveBeenCalledWith("me@example.com", 1, "Europe/Berlin");
    });

    it("tells them in Japanese in Japanese mode", async () => {
      vi.stubEnv("LOCALE", "ja");
      mocks.getTimezone.mockReturnValue("Asia/Tokyo");
      mocks.fetchTodayEvents.mockResolvedValue([dentist]);

      expect(await new CalendarFeature(config).getContext()).toBe("今日の予定: 18:00 Dentist");
    });

    it("says all day instead of a time for an event with only a date", async () => {
      mocks.fetchTodayEvents.mockResolvedValue([holiday, dentist]);
      mocks.fetchUpcomingEvents.mockResolvedValue([holiday]);

      expect(await new CalendarFeature(config).getContext()).toBe(
        "Today's schedule: all day Holiday, 10:00 AM Dentist\nNext event: all day Holiday (in progress)"
      );
    });

    it("says all day in Japanese in Japanese mode", async () => {
      vi.stubEnv("LOCALE", "ja");
      mocks.fetchTodayEvents.mockResolvedValue([holiday]);

      expect(await new CalendarFeature(config).getContext()).toBe("今日の予定: 終日 Holiday");
    });
  });

  it("returns nothing when disabled", async () => {
    expect(await new CalendarFeature({ ...config, enabled: false }).getContext()).toBe("");
  });
});
