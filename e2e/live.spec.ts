import type { Page } from "@playwright/test";
import { test, expect, AvatarPage } from "./fixtures";

// Live mode on the page, with WebRTC and /api/live faked: the real session would need GPT-Live.
// src/lib/live and /api/live's unit tests cover the server side.

interface LiveEvent {
  type: string;
  delta?: string;
  reason?: string;
}

declare global {
  interface Window {
    __live: { offers: number; answer?: string; closed: number; sent: LiveEvent[] };
    __liveDeliver: (event: LiveEvent) => void;
  }
}

/** A stand-in for RTCPeerConnection, whose data channel the test speaks for */
function fakeWebRTC() {
  window.__live = { offers: 0, closed: 0, sent: [] };
  class FakeChannel {
    readyState = "connecting";
    onmessage: ((event: MessageEvent) => void) | null = null;
    send(data: string) {
      window.__live.sent.push(JSON.parse(data));
    }
  }
  let channel: FakeChannel | null = null;
  window.__liveDeliver = (event) => channel?.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
  class FakePeerConnection {
    connectionState = "new";
    ontrack = null;
    onconnectionstatechange = null;
    addTrack() {}
    createDataChannel() {
      channel = new FakeChannel();
      return channel;
    }
    async createOffer() {
      window.__live.offers++;
      return { type: "offer", sdp: "v=0 fake offer" };
    }
    async setLocalDescription() {}
    async setRemoteDescription(answer: { sdp: string }) {
      window.__live.answer = answer.sdp;
      if (channel) channel.readyState = "open";
    }
    close() {
      window.__live.closed++;
    }
  }
  (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = FakePeerConnection;
}

/** Turns live mode on for this page, and answers its session requests with this */
async function useLive(page: Page, session: { status: number; json: Record<string, unknown> }, idleTimeout = 5) {
  await page.addInitScript(fakeWebRTC);
  await page.route("**/api/live", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { enabled: true, idleTimeout, maxDuration: 300 } })
      : route.fulfill(session)
  );
  const transcripts: unknown[] = [];
  await page.route("**/api/live/transcript", (route) => {
    transcripts.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { extracting: true } });
  });
  const avatar = new AvatarPage(page);
  await avatar.open();
  return { avatar, transcripts };
}

const deliver = (page: Page, event: LiveEvent) => page.evaluate((e) => window.__liveDeliver(e), event);

test.describe("Live mode", () => {
  test("holds the conversation after the wake word, and closes the session once it goes quiet", async ({ page, mock }) => {
    const { avatar, transcripts } = await useLive(page, { status: 200, json: { sdp: "v=0 fake answer" } });

    await avatar.hear("hey mira");

    await expect(page.getByText("Connecting…")).toBeVisible();
    await avatar.waitForPost("/api/live");
    expect(avatar.postsTo("/api/live")).toEqual([{ sdp: "v=0 fake offer" }]);
    await expect.poll(() => page.evaluate(() => window.__live.answer)).toBe("v=0 fake answer");

    await deliver(page, { type: "session.started" });
    await expect(page.getByText("In Conversation")).toBeVisible();
    for (const delta of [" What time", " is it?"]) await deliver(page, { type: "session.input_transcript.delta", delta });
    for (const delta of [" It's", " 7:06."]) await deliver(page, { type: "session.output_transcript.delta", delta });
    await expect(page.getByText("What time is it?")).toBeVisible();
    await expect(page.getByText("It's 7:06.")).toBeVisible();

    // GPT-Live hears the room now, so nothing records for /api/stt
    await page.waitForTimeout(1000);
    expect(await avatar.isListening()).toBe(false);
    expect(avatar.postsTo("/api/stt")).toHaveLength(1);
    expect((await mock.localTranscriptions()).map((r) => r.text)).toEqual(["hey mira"]);
    expect(await mock.transcriptions()).toEqual([]);
    expect(avatar.postsTo("/api/chat")).toEqual([]);

    // 5 s without anything heard or said
    await expect(page.getByText('Say "Hey Mira"').first()).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => window.__live.sent)).toEqual([{ type: "session.close" }]);
    await expect.poll(() => page.evaluate(() => window.__live.closed)).toBe(1);
    expect(transcripts).toEqual([
      {
        messages: [
          { role: "user", content: "What time is it?" },
          { role: "assistant", content: "It's 7:06." },
        ],
      },
    ]);
  });

  test("hands the conversation to the voice pipeline when the session can't start", async ({ page }) => {
    const { avatar } = await useLive(page, {
      status: 502,
      json: { error: "Incorrect API key provided", code: "invalid_key", service: "openai" },
    });

    await avatar.wakeUp();

    await expect(page.getByText("Live conversation: OpenAI rejected the API key.")).toBeVisible();
    await avatar.hear("tell me a joke");
    await avatar.waitForPost("/api/chat");
    expect(avatar.postsTo("/api/chat")[0].messages).toEqual([{ role: "user", content: "tell me a joke" }]);
    await expect(page.getByText("mock reply to: tell me a joke")).toBeVisible();
  });

  test("closes the session when the mic is turned off", async ({ page, context }) => {
    const { avatar } = await useLive(page, { status: 200, json: { sdp: "v=0 fake answer" } }, 60);
    await avatar.hear("hey mira");
    await avatar.waitForPost("/api/live");
    await deliver(page, { type: "session.started" });
    await expect(page.getByText("In Conversation")).toBeVisible();

    const control = await context.newPage();
    await control.goto("/control", { waitUntil: "networkidle" });
    await control.getByTitle("Mic Off").click();

    await expect.poll(() => page.evaluate(() => window.__live.sent)).toEqual([{ type: "session.close" }]);
    await expect.poll(() => page.evaluate(() => window.__live.closed)).toBe(1);
  });

  test("stays off unless the config turns it on", async ({ avatar }) => {
    await avatar.wakeUp();
    await avatar.hear("tell me a joke");

    await avatar.waitForPost("/api/chat");
    expect(avatar.postsTo("/api/live")).toEqual([]);
  });
});
