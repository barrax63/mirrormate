import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CalendarFeature } from "./index";

const mocks = vi.hoisted(() => ({ fetchTodayEvents: vi.fn(), fetchUpcomingEvents: vi.fn() }));

vi.mock("./google-calendar", () => ({
  fetchTodayEvents: mocks.fetchTodayEvents,
  fetchUpcomingEvents: mocks.fetchUpcomingEvents,
}));

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
  });

  afterEach(() => {
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

  it("returns nothing when disabled", async () => {
    expect(await new CalendarFeature({ ...config, enabled: false }).getContext()).toBe("");
  });
});
