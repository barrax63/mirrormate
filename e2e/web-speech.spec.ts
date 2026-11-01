import type { Page, Route } from "@playwright/test";
import { webSpeechTest as test, expect, WebSpeechAvatarPage, JA_URL } from "./fixtures";

test.describe("Speech provider", () => {
  async function openWithConfig(page: Page, answer: (route: Route) => Promise<void>) {
    await page.route("**/api/stt/config", answer);
    const avatar = new WebSpeechAvatarPage(page);
    await avatar.open();
    return avatar;
  }

  // In Chrome, Web Speech sends the mic to Google, which a local Whisper setup is chosen to avoid
  test("never starts Web Speech when a Whisper provider is configured", async ({ page }) => {
    const avatar = await openWithConfig(page, (route) =>
      route.fulfill({ json: { enabled: true, provider: "local", silenceDetection: {}, language: "en" } })
    );

    await avatar.waitForLog("[AudioRecorder] Started recording");
    await page.waitForTimeout(1000);

    expect(avatar.recognitionStarts()).toBe(0);
    expect(await page.evaluate(() => window.__recognitions.length)).toBe(0);
  });

  test("uses Web Speech when the config request fails", async ({ page }) => {
    const avatar = await openWithConfig(page, (route) => route.abort());

    await expect.poll(() => avatar.isListening()).toBe(true);
  });

  test("uses Web Speech when the config request returns an error", async ({ page }) => {
    const avatar = await openWithConfig(page, (route) => route.fulfill({ status: 500 }));

    await expect.poll(() => avatar.isListening()).toBe(true);
  });
});

test.describe("Recognition restarts", () => {
  async function openFailing(page: Page, error: string) {
    await page.addInitScript((failure) => {
      window.__recognitionFailure = failure;
    }, error);
    const avatar = new WebSpeechAvatarPage(page);
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

  test("listens again when a reply ends before recognition has stopped", async ({ avatar, control, mock }) => {
    // Much shorter than the time the stub takes to fire `end` after stop()
    await mock.setAudioLength(50);

    await control.send("short reply");

    await avatar.waitForLog("Audio playback ended");
    await avatar.waitForLog("Web Speech ended");
    await expect.poll(() => avatar.isListening()).toBe(true);
  });
});

test.describe("Web Speech language", () => {
  test("starts in en-US", async ({ avatar }) => {
    await expect.poll(() => avatar.recognitionLanguage()).toBe("en-US");
  });

  test("known bug: starts in the language from the STT config", async ({ page }) => {
    await page.route("**/api/stt/config", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), provider: "web", language: "de-DE" } });
    });
    const avatar = new WebSpeechAvatarPage(page);
    await avatar.open();
    await expect.poll(() => avatar.recognitionLanguage()).toBeTruthy();

    test.fail(true, "src/app/page.tsx passes no language to useSpeechRecognition");
    await expect.poll(() => avatar.recognitionLanguage(), { timeout: 2000 }).toBe("de-DE");
  });

  test.describe("on the Japanese server", () => {
    test.use({ baseURL: JA_URL });

    test("known bug: starts in ja-JP", async ({ avatar }) => {
      await expect.poll(() => avatar.recognitionLanguage()).toBeTruthy();

      test.fail(true, "src/app/page.tsx passes no language to useSpeechRecognition");
      await expect.poll(() => avatar.recognitionLanguage(), { timeout: 2000 }).toBe("ja-JP");
    });
  });
});
