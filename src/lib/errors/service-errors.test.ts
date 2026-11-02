import { describe, it, expect, vi } from "vitest";
import { FIRST_BACKOFF_MS, MAX_BACKOFF_MS, ServiceErrors, routeErrorFrom } from "./service-errors";

function tracker() {
  let now = 1_000_000;
  const errors = new ServiceErrors(() => now);
  return { errors, advance: (ms: number) => (now += ms) };
}

describe("ServiceErrors", () => {
  it("waits after a rejected key, twice as long each time, up to 10 minutes", () => {
    const { errors, advance } = tracker();
    const waits: number[] = [];

    for (let i = 0; i < 7; i++) {
      errors.failed("speech", { code: "invalid_key", service: "openai" });
      let waited = 0;
      while (errors.isBackingOff("speech")) {
        advance(1000);
        waited += 1000;
      }
      waits.push(waited);
    }

    expect(waits).toEqual([30, 60, 120, 240, 480, 600, 600].map((s) => s * 1000));
    expect(FIRST_BACKOFF_MS).toBe(30_000);
    expect(MAX_BACKOFF_MS).toBe(600_000);
  });

  it.each(["missing_key", "invalid_key", "missing_permissions", "quota_exceeded", "rate_limited"] as const)(
    "waits after %s",
    (code) => {
      const { errors } = tracker();

      errors.failed("chat", { code });

      expect(errors.isBackingOff("chat")).toBe(true);
    }
  );

  it.each(["unavailable", "failed"] as const)("asks again straight away after %s", (code) => {
    const { errors } = tracker();

    errors.failed("chat", { code });

    expect(errors.isBackingOff("chat")).toBe(false);
    expect(errors.getSnapshot()).toEqual([{ route: "chat", error: { code } }]);
  });

  it("waits as long as a rate limit asks", () => {
    const { errors, advance } = tracker();

    errors.failed("tts", { code: "rate_limited", retryAfter: 2 });
    advance(1999);
    expect(errors.isBackingOff("tts")).toBe(true);
    advance(1);
    expect(errors.isBackingOff("tts")).toBe(false);
  });

  it("keeps each route apart", () => {
    const { errors } = tracker();

    errors.failed("speech", { code: "invalid_key", service: "openai" });

    expect(errors.isBackingOff("speech")).toBe(true);
    expect(errors.isBackingOff("wakeWord")).toBe(false);
    expect(errors.isBackingOff("chat")).toBe(false);
  });

  it("clears the error and the wait after a success", () => {
    const { errors } = tracker();
    const listener = vi.fn();
    errors.subscribe(listener);
    errors.failed("speech", { code: "invalid_key" });
    errors.failed("speech", { code: "invalid_key" });

    expect(errors.succeeded("speech")).toBe(true);

    expect(errors.isBackingOff("speech")).toBe(false);
    expect(errors.getSnapshot()).toEqual([]);
    // Starts again at the shortest wait
    errors.failed("speech", { code: "invalid_key" });
    expect(errors.states()[0][1].backoffs).toBe(1);
    expect(errors.succeeded("tts")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("keeps the snapshot until something changes, in route order", () => {
    const { errors } = tracker();
    errors.failed("tts", { code: "failed", service: "elevenlabs" });
    errors.failed("wakeWord", { code: "unavailable", service: "localWhisper" });

    const snapshot = errors.getSnapshot();

    expect(errors.getSnapshot()).toBe(snapshot);
    expect(snapshot.map(({ route }) => route)).toEqual(["wakeWord", "tts"]);
  });
});

describe("routeErrorFrom", () => {
  it("reads the code, service and wait a route sent", async () => {
    const response = Response.json(
      { error: "Rate limit reached", code: "rate_limited", service: "openai", retryAfter: 4 },
      { status: 429 }
    );

    expect(await routeErrorFrom(response)).toEqual({ code: "rate_limited", service: "openai", retryAfter: 4 });
  });

  it.each([
    [429, "rate_limited"],
    [503, "unavailable"],
    [500, "failed"],
    [404, "failed"],
  ])("goes by the status %i when the body doesn't say", async (status, code) => {
    expect(await routeErrorFrom(new Response("Not JSON", { status }))).toEqual({ code });
  });

  it("ignores a code or service it doesn't know", async () => {
    const unknownCode = Response.json({ code: "teapot" }, { status: 503 });
    const unknownService = Response.json({ code: "failed", service: "somewhere" }, { status: 502 });

    expect(await routeErrorFrom(unknownCode)).toEqual({ code: "unavailable" });
    expect(await routeErrorFrom(unknownService)).toEqual({ code: "failed" });
  });
});
