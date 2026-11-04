import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ fetchUpcomingEvents: vi.fn() }));

vi.mock("@/lib/features/calendar/google-calendar", () => ({ fetchUpcomingEvents: mocks.fetchUpcomingEvents }));

vi.mock("@/lib/features/config-loader", () => ({
  loadFeaturesConfig: () => ({
    features: { reminder: { enabled: true, pollingInterval: 30, reminders: [{ minutes: 10, urgent: false }] } },
  }),
  getTimezone: () => "Europe/Berlin",
}));

describe("GET /api/reminder", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T22:50:00Z"));
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "mirror@example.iam.gserviceaccount.com");
    vi.stubEnv("GOOGLE_PRIVATE_KEY", "test-key");
    vi.stubEnv("GOOGLE_CALENDAR_ID", "me@example.com");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("reminds about an event starting soon, and not about an all-day one starting at midnight", async () => {
    mocks.fetchUpcomingEvents.mockResolvedValue([
      // Midnight in Berlin, 10 minutes from now
      {
        summary: "Holiday",
        start: new Date("2026-11-04T23:00:00Z"),
        end: new Date("2026-11-05T23:00:00Z"),
        allDay: true,
      },
      {
        summary: "Late call",
        start: new Date("2026-11-04T23:00:00Z"),
        end: new Date("2026-11-04T23:30:00Z"),
        allDay: false,
      },
    ]);

    const { reminders } = await (await GET()).json();

    expect(mocks.fetchUpcomingEvents).toHaveBeenCalledWith("me@example.com", 5, "Europe/Berlin");
    expect(reminders.map((reminder: { summary: string }) => reminder.summary)).toEqual(["Late call"]);
  });
});
