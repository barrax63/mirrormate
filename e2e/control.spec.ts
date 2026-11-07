import type { Page, Route } from "@playwright/test";
import { test, expect, blockOutsideRequests, AvatarPage, ControlPage, JAPANESE, JPEG_DATA_URL } from "./fixtures";

// Lily is in the fake ElevenLabs' voice list, and the characters give her to Luna
const LILY = "pFZP5JQG7iQjIQuC4Bku";

test.describe("Voice selector", () => {
  async function openWithVoices(page: Page, answer: (route: Route) => Promise<void>) {
    await page.route("**/api/voices", answer);
    const control = new ControlPage(page);
    await control.open();
  }

  test("lists the ElevenLabs voices by name", async ({ control }) => {
    await control.page.getByRole("button", { name: "Select voice" }).click();

    for (const name of ["Jessica", "Lily", "Mock", "Sarah"]) {
      await expect(control.page.getByText(name).first()).toBeVisible();
    }
  });

  test("says the voices are unavailable when ElevenLabs can't list them", async ({ page }) => {
    await openWithVoices(page, (route) =>
      route.fulfill({ status: 502, json: { voices: [], error: "ElevenLabs voices unavailable" } })
    );

    await expect(page.getByRole("button", { name: "Voices unavailable" })).toBeDisabled();
  });

  test("says the voices are unavailable when the request fails", async ({ page }) => {
    await openWithVoices(page, (route) => route.abort());

    await expect(page.getByRole("button", { name: "Voices unavailable" })).toBeDisabled();
  });

  test("speaks replies in the voice picked", async ({ avatar, control, mock }) => {
    await control.selectVoice("Lily");

    await control.send("in another voice");

    await avatar.waitForLog("Audio playback ended");
    const [speech] = await mock.speech();
    expect(speech.path).toBe(`/v1/text-to-speech/${LILY}`);
  });

  test("keeps the voice picked after the avatar page reloads", async ({ avatar, control, mock }) => {
    await control.selectVoice("Lily");
    await expect.poll(async () => (await (await control.page.request.get("/api/settings")).json()).voice).toBe(LILY);

    await avatar.open();
    await avatar.wakeUp();
    await avatar.hear("which voice is this");

    await avatar.waitForLog("Audio playback ended");
    const [speech] = await mock.speech();
    expect(speech.path).toBe(`/v1/text-to-speech/${LILY}`);
  });

  test("switches to the voice of the character picked, and saves both", async ({ avatar, control, mock }) => {
    await control.selectCharacter("Luna");

    await control.send("hello Luna");

    await avatar.waitForLog("Audio playback ended");
    const [speech] = await mock.speech();
    expect(speech.path).toBe(`/v1/text-to-speech/${LILY}`);
    await expect
      .poll(async () => (await control.page.request.get("/api/settings")).json())
      .toEqual({ voice: LILY, characterId: "luna", visionEnabled: true });
  });

  test("previews a voice with its own /api/tts call", async ({ avatar, control }) => {
    await control.selectVoice("Lily");
    await control.page.getByTitle("Preview").click();

    await control.waitForPost("/api/tts");
    expect(control.postsTo("/api/tts")[0].voice).toBe(LILY);
    expect(avatar.postsTo("/api/tts")).toEqual([]);
  });

  test("previews a voice with English text in English mode", async ({ control }) => {
    await control.selectVoice("Lily");
    await control.page.getByTitle("Preview").click();
    await control.waitForPost("/api/tts");

    expect(control.postsTo("/api/tts")[0].text).toBe("Hello, this is what my voice sounds like.");
  });

  test("shows no Japanese in English mode", async ({ control }) => {
    await control.selectVoice("Lily");

    expect(await control.page.locator("body").innerText()).not.toMatch(JAPANESE);
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
    // Neither what was sent nor the reply
    expect(avatar.logs).toContainEqual(expect.stringMatching(/play_audio: requesting TTS.*characters: 33/));
    expect([...avatar.logs, ...control.logs].filter((log) => log.includes("from control"))).toEqual([]);
  });

  test("shows the whole conversation, but sends only the latest messages", async ({ control }) => {
    for (const question of ["question 1", "question 2", "question 3"]) {
      await control.send(question);
      await expect(control.page.getByText(`mock reply to: ${question}`)).toBeVisible();
    }

    await control.send("question 4");

    await expect(control.page.getByText("mock reply to: question 4")).toBeVisible();
    await expect(control.page.getByText("question 1", { exact: true })).toBeVisible();
    // e2e/config/providers.yaml sets the limit to 4
    expect(control.postsTo("/api/chat")[3].messages).toEqual([
      { role: "user", content: "question 3" },
      { role: "assistant", content: "mock reply to: question 3" },
      { role: "user", content: "question 4" },
    ]);
  });

  test("doesn't send the LLM its own error notice as a reply", async ({ control }) => {
    await control.page.route("**/api/chat", (route) => route.abort(), { times: 1 });
    await control.send("first try");
    await expect(control.page.locator("p", { hasText: "Replies: The server can't be reached." })).toBeVisible();

    await control.send("second try");

    await expect(control.page.getByText("mock reply to: second try")).toBeVisible();
    expect(control.postsTo("/api/chat").at(-1)?.messages).toEqual([
      { role: "user", content: "first try" },
      { role: "user", content: "second try" },
    ]);
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
    expect(await mock.localTranscriptions()).toEqual([]);
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

    // It's waiting for the wake word, so local Whisper gets it
    const [recording] = await mock.localTranscriptions();
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

  test("keeps the image out of voice requests while off", async ({ avatar, control }) => {
    await control.turnVisionOff();
    await avatar.wakeUp();

    await avatar.hear("can you see me");
    await avatar.waitForPost("/api/chat");
    const [chat] = avatar.postsTo("/api/chat");
    expect(chat.messages).toEqual([{ role: "user", content: "can you see me" }]);
    expect(chat.image).toBeUndefined();
  });

  test("stops the camera while off", async ({ avatar, control }) => {
    expect(await avatar.liveVideoTracks()).toBe(1);

    await control.turnVisionOff();

    await expect.poll(() => avatar.liveVideoTracks()).toBe(0);
  });

  test("turns the camera and the images back on with Vision", async ({ avatar, control }) => {
    await control.turnVisionOff();
    await expect.poll(() => avatar.liveVideoTracks()).toBe(0);

    await control.page.getByRole("button", { name: "Vision OFF" }).click();

    await expect.poll(() => avatar.liveVideoTracks()).toBe(1);
    await avatar.wakeUp();
    await avatar.hear("can you see me now");
    await avatar.waitForPost("/api/chat");
    expect(avatar.postsTo("/api/chat")[0].image).toMatch(JPEG_DATA_URL);
  });

  test.describe("after a reload", () => {
    test.beforeEach(async ({ control }) => {
      await control.turnVisionOff();
      await expect
        .poll(async () => (await (await control.page.request.get("/api/settings")).json()).visionEnabled)
        .toBe(false);
    });

    test("stays off on /control", async ({ control }) => {
      await control.page.reload({ waitUntil: "networkidle" });

      // The button is disabled until the setting has loaded
      await expect(control.page.getByRole("button", { name: "Vision OFF" })).toBeEnabled();
    });

    test("shows off on a /control opened later", async ({ context }) => {
      const later = await context.newPage();
      await later.goto("/control", { waitUntil: "networkidle" });

      await expect(later.getByRole("button", { name: "Vision OFF" })).toBeEnabled();
    });

    test("never opens the camera on the avatar page, and sends no image", async ({ avatar }) => {
      await avatar.page.reload({ waitUntil: "networkidle" });
      await avatar.page.waitForTimeout(1000);

      expect(await avatar.cameraRequests()).toBe(0);
      expect(await avatar.liveVideoTracks()).toBe(0);
      await avatar.wakeUp();
      await avatar.hear("can you see me");
      await avatar.waitForPost("/api/chat");
      expect(avatar.postsTo("/api/chat")[0].image).toBeUndefined();
    });
  });
});
