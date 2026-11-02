import type { Page, Route } from "@playwright/test";
import { test, expect, blockOutsideRequests, AvatarPage, ControlPage, JAPANESE, JPEG_DATA_URL } from "./fixtures";

test.describe("Voice selector", () => {
  async function openWithVoices(page: Page, answer: (route: Route) => Promise<void>) {
    await page.route("**/api/voicevox/speakers", answer);
    const control = new ControlPage(page);
    await control.open();
  }

  // The speaker only reaches VOICEVOX, so a selector would change nothing with OpenAI
  test("is hidden when replies don't use VOICEVOX", async ({ page }) => {
    await openWithVoices(page, (route) => route.fulfill({ json: { speakers: [], enabled: false } }));

    await expect(page.getByRole("button", { name: "Vision ON" })).toBeVisible();
    await expect(page.getByText("Voice", { exact: true })).toBeHidden();
    await expect(page.getByTitle("Preview")).toBeHidden();
  });

  test("says VOICEVOX is unavailable when replies use it and it's down", async ({ page }) => {
    await openWithVoices(page, (route) =>
      route.fulfill({ status: 503, json: { speakers: [], error: "VOICEVOX unavailable" } })
    );

    await expect(page.getByRole("button", { name: "VOICEVOX unavailable" })).toBeDisabled();
  });

  test("stays visible when the voice request fails", async ({ page }) => {
    await openWithVoices(page, (route) => route.abort());

    await expect(page.getByRole("button", { name: "Failed to fetch speakers" })).toBeDisabled();
  });
});

test.describe("Control page", () => {
  test("sends chat itself and has the avatar page speak the reply", async ({ avatar, control }) => {
    await control.send("hello from control");

    await avatar.waitForPost("/api/tts");
    const [chat] = control.postsTo("/api/chat");
    expect(chat).toMatchObject({
      messages: [{ role: "user", content: "hello from control" }],
    });
    expect(chat.image).toMatch(JPEG_DATA_URL);
    expect(avatar.postsTo("/api/tts")[0].text).toBe("mock reply to: hello from control");
    expect(avatar.postsTo("/api/chat")).toEqual([]);
    expect(control.postsTo("/api/tts")).toEqual([]);

    await expect(avatar.page.getByText("mock reply to: hello from control")).toBeVisible();
    await expect(control.page.getByText("mock reply to: hello from control")).toBeVisible();
    expect(control.errors).toEqual([]);
  });

  test("can't reach the avatar page from another browser profile", async ({ browser, avatar, baseURL }) => {
    const otherProfile = await browser.newContext({ baseURL });
    await blockOutsideRequests(otherProfile);
    const other = await otherProfile.newPage();
    const chats: string[] = [];
    other.on("request", (request) => {
      if (request.url().endsWith("/api/chat")) chats.push(request.postDataJSON().image ?? "no image");
    });

    await other.goto("/control", { waitUntil: "networkidle" });
    await other.locator("form input").fill("from another profile");
    await other.locator("form input").press("Enter");

    await expect(other.getByText("mock reply to: from another profile")).toBeVisible();
    expect(chats).toEqual(["no image"]);
    await expect(avatar.page.getByText("from another profile")).toHaveCount(0);
    expect(avatar.postsTo("/api/tts")).toEqual([]);
    await otherProfile.close();
  });

  test("plays a reply to the end with the mic off", async ({ avatar, control, mock }) => {
    await mock.setAudioLength(2000);
    await control.page.getByTitle("Mic Off").click();
    await expect(control.page.getByText("Mic Off", { exact: true })).toBeVisible();
    await expect.poll(() => avatar.isListening()).toBe(false);

    await control.send("reply with the mic off");

    await avatar.waitForLog("Audio playback ended");
    await avatar.waitForLog("[Avatar] Audio playback finished");
  });

  test("plays a reply to the end with the mic listening", async ({ avatar, control, mock }) => {
    await mock.setAudioLength(2000);

    await control.send("reply with the mic listening");

    await avatar.waitForLog("Audio playback started");
    await avatar.waitForLog("Audio playback ended");
    await avatar.waitForLog("[Avatar] Audio playback finished");
  });

  test("listens again after a reply, so voice keeps working", async ({ avatar, control, mock }) => {
    await mock.setAudioLength(2000);

    await control.send("reply before voice");
    await avatar.waitForLog("Audio playback started");
    await expect.poll(() => avatar.isListening()).toBe(false);
    await avatar.waitForLog("Audio playback ended");
    await expect.poll(() => avatar.isListening()).toBe(true);

    await avatar.wakeUp();
    await avatar.hear("voice after the reply");
    await avatar.waitForPost("/api/chat");
    expect(avatar.postsTo("/api/chat")[0].messages).toEqual([{ role: "user", content: "voice after the reply" }]);
  });

  test("listens again after overlapping replies", async ({ avatar, control, mock }) => {
    await mock.setAudioLength(1000);

    await control.send("first reply");
    await avatar.waitForLog("Audio playback started");
    await control.send("second reply");
    await avatar.waitForPost("/api/tts", 2);

    await expect.poll(() => avatar.logs.filter((log) => log.includes("Audio playback ended")).length).toBe(2);
    await expect.poll(() => avatar.isListening()).toBe(true);
  });

  test("shows the mic status as replies pause and resume recognition", async ({ avatar, control, mock }) => {
    await mock.setAudioLength(2000);
    await expect(control.page.getByText("Listening", { exact: true })).toBeVisible();

    await control.send("mic status");

    await expect(control.page.getByText("Paused", { exact: true })).toBeVisible();
    await avatar.waitForLog("Audio playback ended");
    await expect(control.page.getByText("Listening", { exact: true })).toBeVisible();
  });

  test("sends nothing when the mic is turned off before any speech", async ({ avatar, control, mock }) => {
    await expect.poll(() => avatar.isListening()).toBe(true);

    await control.page.getByTitle("Mic Off").click();

    await expect.poll(() => avatar.liveRecorders()).toBe(0);
    await avatar.waitForLog("no voice detected, discarding");
    expect(await mock.transcriptions()).toEqual([]);
  });

  test("stops recording when the mic is turned off a second time", async ({ avatar, control }) => {
    await expect.poll(() => avatar.isListening()).toBe(true);
    await control.page.getByTitle("Mic Off").click();
    await expect.poll(() => avatar.liveRecorders()).toBe(0);
    await control.page.getByTitle("Mic On").click();
    await expect.poll(() => avatar.isListening()).toBe(true);
    await control.page.getByTitle("Mic Off").click();
    await expect.poll(() => avatar.isListening()).toBe(false);
    await avatar.page.waitForTimeout(500);

    expect(await avatar.liveRecorders()).toBe(0);
    expect(await avatar.liveMicStreams()).toBe(0);
  });

  test("uploads one recording after the mic is turned back on", async ({ avatar, control, mock }) => {
    await expect.poll(() => avatar.isListening()).toBe(true);
    await control.page.getByTitle("Mic Off").click();
    await expect.poll(() => avatar.liveRecorders()).toBe(0);
    await control.page.getByTitle("Mic On").click();
    await expect.poll(() => avatar.isListening()).toBe(true);

    await avatar.hear("hello");

    const [recording] = await mock.transcriptions();
    expect(recording.audio.webmFiles).toBe(1);
  });

  // The page asks for the mic as it loads, and it stays opening until releaseMic()
  test.describe("while the mic is still opening", () => {
    test.use({ micHeld: true });

    async function turnOff(avatar: AvatarPage, control: ControlPage) {
      await control.page.getByTitle("Mic Off").click();
      await expect(avatar.page.getByText("Mic Off", { exact: true }).first()).toBeVisible();
    }

    function recordingStarts(avatar: AvatarPage) {
      return avatar.logs.filter((log) => log.includes("[AudioRecorder] Started recording")).length;
    }

    test.beforeEach(async ({ avatar }) => {
      await expect.poll(() => avatar.micRequests()).toBeGreaterThan(0);
    });

    test("closes it if the mic is turned off", async ({ avatar, control }) => {
      await turnOff(avatar, control);

      await avatar.releaseMic();

      expect(await avatar.liveRecorders()).toBe(0);
      expect(await avatar.liveMicStreams()).toBe(0);
    });

    test("records once if the mic is turned off and back on", async ({ avatar, control }) => {
      await turnOff(avatar, control);
      await control.page.getByTitle("Mic On").click();
      await expect(avatar.page.getByText("Paused", { exact: true })).toBeVisible();

      await avatar.releaseMic();

      expect(await avatar.liveRecorders()).toBe(1);
      expect(await avatar.liveMicStreams()).toBe(1);
    });

    test("closes it without recording if a reply starts", async ({ avatar, control, mock }) => {
      await mock.setAudioLength(3000);
      await control.send("long reply");
      await avatar.waitForLog("Audio playback started");

      await avatar.releaseMic();

      expect(recordingStarts(avatar)).toBe(0);
      expect(await avatar.liveMicStreams()).toBe(0);
      await avatar.waitForLog("Audio playback ended");
      await expect.poll(() => avatar.isListening()).toBe(true);
    });

    test("records once if a reply starts and ends", async ({ avatar, control }) => {
      await control.send("short reply");
      await avatar.waitForLog("Audio playback ended");

      await avatar.releaseMic();

      expect(await avatar.liveRecorders()).toBe(1);
      expect(await avatar.liveMicStreams()).toBe(1);
    });
  });

  test("tells a /control page opened later the current mic status", async ({ context, avatar, control }) => {
    await control.page.getByTitle("Mic Off").click();
    await expect.poll(() => avatar.isListening()).toBe(false);

    const later = await context.newPage();
    await later.goto("/control", { waitUntil: "networkidle" });

    await expect(later.getByText("Mic Off", { exact: true })).toBeVisible();
  });

  test("previews a voice with its own /api/tts call", async ({ avatar, control }) => {
    await control.selectMockVoice();
    await control.page.getByTitle("Preview").click();

    await control.waitForPost("/api/tts");
    expect(control.postsTo("/api/tts")[0].speaker).toBe(2);
    expect(avatar.postsTo("/api/tts")).toEqual([]);
  });

  test("known bug: previews a voice with English text in English mode", async ({ control }) => {
    await control.selectMockVoice();
    await control.page.getByTitle("Preview").click();
    await control.waitForPost("/api/tts");

    test.fail(true, "The preview text is always Japanese");
    expect(control.postsTo("/api/tts")[0].text).not.toMatch(JAPANESE);
  });

  test("shows no Japanese in English mode", async ({ control }) => {
    await control.selectMockVoice();

    expect(await control.page.locator("body").innerText()).not.toMatch(JAPANESE);
  });
});

test.describe("Vision toggle", () => {
  test("keeps the image out of /control's requests while off", async ({ control }) => {
    await control.turnVisionOff();

    await control.send("vision is off");

    await expect(control.page.getByText("mock reply to: vision is off")).toBeVisible();
    const [chat] = control.postsTo("/api/chat");
    expect(chat.messages).toEqual([{ role: "user", content: "vision is off" }]);
    expect(chat.image).toBeUndefined();
  });

  test("known bug: keeps the image out of voice requests while off", async ({ avatar, control }) => {
    await control.turnVisionOff();
    await avatar.wakeUp();

    await avatar.hear("can you see me");
    await avatar.waitForPost("/api/chat");
    const [chat] = avatar.postsTo("/api/chat");
    expect(chat.messages).toEqual([{ role: "user", content: "can you see me" }]);

    test.fail(true, "Nothing receives vision_toggle, so the voice flow always captures a frame");
    expect(chat.image).toBeUndefined();
  });

  test("known bug: stops the camera while off", async ({ avatar, control }) => {
    expect(await avatar.liveVideoTracks()).toBe(1);

    await control.turnVisionOff();

    test.fail(true, "Nothing receives vision_toggle, so the stream keeps running");
    await expect.poll(() => avatar.liveVideoTracks(), { timeout: 3000 }).toBe(0);
  });

  test("known bug: stays off after a reload", async ({ control }) => {
    await control.turnVisionOff();

    await control.page.reload({ waitUntil: "networkidle" });
    await expect(control.page.getByRole("button", { name: /^Vision O/ })).toBeVisible();

    test.fail(true, "The setting isn't saved, so a reload turns Vision back on");
    await expect(control.page.getByRole("button", { name: "Vision OFF" })).toBeVisible({ timeout: 2000 });
  });
});
