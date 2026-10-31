import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, AvatarPage, JPEG_DATA_URL } from "./fixtures";

test.describe("Avatar page", () => {
  test("renders its plugins without errors", async ({ avatar }) => {
    await expect(avatar.page.locator("body")).toContainText(/\d{1,2}:\d{2}/);
    expect(avatar.logs.filter((log) => log.includes("Unknown plugin"))).toEqual([]);
    expect(avatar.errors).toEqual([]);
  });

  test("keeps a live camera stream in the hidden vision plugin", async ({ avatar }) => {
    await expect(avatar.page.locator("video")).toBeHidden();
    expect(await avatar.liveVideoTracks()).toBe(1);
  });
});

test.describe("Voice flow", () => {
  test("ignores speech until the wake word", async ({ avatar }) => {
    await avatar.hear("what time is it");
    await avatar.wakeUp();

    // A request would have started by now, since capturing a camera frame is quick
    await avatar.page.waitForTimeout(1000);
    expect(avatar.postsTo("/api/chat")).toEqual([]);
  });

  test("sends what it hears after the wake word and speaks the reply", async ({ avatar }) => {
    await avatar.wakeUp();
    await avatar.hear("tell me a joke");

    await avatar.waitForPost("/api/tts");
    const [chat] = avatar.postsTo("/api/chat");
    expect(chat).toMatchObject({
      withAudio: false,
      messages: [{ role: "user", content: "tell me a joke" }],
    });
    expect(chat.image).toMatch(JPEG_DATA_URL);
    expect(avatar.postsTo("/api/tts")[0].text).toBe("mock reply to: tell me a joke");

    await avatar.waitForLog("Audio playback ended");
    await expect(avatar.page.getByText("mock reply to: tell me a joke")).toBeVisible();
    expect(avatar.errors).toEqual([]);
  });

  test("keeps listening and sends the history on the next turn", async ({ avatar }) => {
    await avatar.wakeUp();
    await avatar.hear("first question");
    await avatar.waitForLog("Audio playback ended");

    await avatar.hear("second question");

    await avatar.waitForPost("/api/chat", 2);
    expect(avatar.postsTo("/api/chat")[1].messages).toEqual([
      { role: "user", content: "first question" },
      { role: "assistant", content: "mock reply to: first question" },
      { role: "user", content: "second question" },
    ]);
  });

  test("pauses recognition while replying and restarts it afterwards", async ({ avatar, mock }) => {
    await mock.setAudioLength(1000);
    await avatar.wakeUp();

    await avatar.hear("say something long");
    await avatar.waitForLog("Audio playback started");
    expect(await avatar.page.evaluate(() => window.__say("interruption"))).toBe(false);

    await avatar.waitForLog("Audio playback ended");
    await avatar.hear("still listening");
    await avatar.waitForPost("/api/chat", 2);
  });

  test("keeps one AudioContext across replies and releases its nodes", async ({ page }) => {
    await page.addInitScript({ path: path.join(__dirname, "audio-spy.js") });
    const avatar = new AvatarPage(page);
    await avatar.open();
    await avatar.wakeUp();

    await avatar.hear("first question");
    await avatar.waitForLog("Audio playback ended");
    await avatar.hear("second question");
    await avatar.waitForPost("/api/tts", 2);
    await expect.poll(() => avatar.logs.filter((log) => log.includes("Audio playback ended")).length).toBe(2);

    const audio = await page.evaluate(() => ({
      contexts: window.__audioContexts.map((context) => context.state),
      links: window.__audioLinks,
    }));
    expect(audio).toEqual({ contexts: ["running"], links: 0 });
  });
});

test.describe("Recognition restarts", () => {
  async function openFailing(page: Page, error: string) {
    await page.addInitScript((failure) => {
      window.__recognitionFailure = failure;
    }, error);
    const avatar = new AvatarPage(page);
    await avatar.open();
    return avatar;
  }

  test("backs off while sessions keep failing", async ({ page }) => {
    const avatar = await openFailing(page, "network");

    await page.waitForTimeout(5000);

    // Attempts at about 0.1, 0.3, 0.7, 1.5, 3.1 and 6.3 s, not one every 50 ms
    expect(avatar.recognitionStarts()).toBeLessThanOrEqual(10);
    expect(Math.max(...avatar.restartDelays())).toBeGreaterThanOrEqual(1600);
  });

  test("gets going again once sessions stop failing", async ({ page }) => {
    const avatar = await openFailing(page, "network");
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      window.__recognitionFailure = null;
    });

    await expect.poll(() => avatar.isListening(), { timeout: 15_000 }).toBe(true);
    await avatar.wakeUp();
    await avatar.hear("voice after the failures");
    await avatar.waitForPost("/api/chat");
  });

  test("keeps restarting quickly when sessions only end from silence", async ({ page }) => {
    const avatar = await openFailing(page, "no-speech");

    await expect.poll(() => avatar.restartDelays().length).toBeGreaterThanOrEqual(5);

    expect(new Set(avatar.restartDelays())).toEqual(new Set([100]));
  });

  test("restarts quickly after a session that ran for a while", async ({ page }) => {
    const avatar = await openFailing(page, "network");
    await expect.poll(() => Math.max(0, ...avatar.restartDelays())).toBeGreaterThanOrEqual(400);
    await page.evaluate(() => {
      window.__recognitionFailure = null;
    });
    await expect.poll(() => avatar.isListening(), { timeout: 15_000 }).toBe(true);

    await page.waitForTimeout(3100);
    await page.evaluate(() => window.__endRecognition());

    await expect.poll(() => avatar.isListening()).toBe(true);
    expect(avatar.restartDelays().at(-1)).toBe(100);
  });

  test("restarts quickly after a session that heard speech", async ({ page }) => {
    const avatar = await openFailing(page, "network");
    await expect.poll(() => Math.max(0, ...avatar.restartDelays())).toBeGreaterThanOrEqual(400);
    await page.evaluate(() => {
      window.__recognitionFailure = null;
    });
    await expect.poll(() => avatar.isListening(), { timeout: 15_000 }).toBe(true);

    await avatar.hear("something that isn't the wake word");
    await page.evaluate(() => window.__endRecognition());

    await expect.poll(() => avatar.isListening()).toBe(true);
    expect(avatar.restartDelays().at(-1)).toBe(100);
  });

  test("keeps only one restart pending", async ({ avatar, control }) => {
    await avatar.page.evaluate(() => {
      window.__recognitionFailure = "network";
      window.__endRecognition();
    });
    await expect.poll(() => Math.max(0, ...avatar.restartDelays())).toBeGreaterThanOrEqual(1600);

    // Turning the mic back on starts a session directly, which fails and schedules a restart
    await control.page.getByTitle("Mic Off").click();
    await control.page.getByTitle("Mic On").click();
    await expect.poll(() => Math.max(0, ...avatar.restartDelays())).toBeGreaterThanOrEqual(3200);
    await avatar.page.waitForTimeout(200);
    const starts = avatar.recognitionStarts();

    // The 1.6 s restart must be gone, and the new one is at least 3.2 s away
    await avatar.page.waitForTimeout(1500);
    expect(avatar.recognitionStarts()).toBe(starts);
  });

  test("stops retrying when the mic is turned off", async ({ avatar, control }) => {
    await avatar.page.evaluate(() => {
      window.__recognitionFailure = "network";
      window.__endRecognition();
    });
    await expect.poll(() => avatar.restartDelays().length).toBeGreaterThanOrEqual(2);

    await control.page.getByTitle("Mic Off").click();
    await expect(control.page.getByText("Mic Off", { exact: true })).toBeVisible();
    await avatar.page.waitForTimeout(500);
    const starts = avatar.recognitionStarts();

    await avatar.page.waitForTimeout(3000);
    expect(avatar.recognitionStarts()).toBe(starts);
  });
});
