import type { Page } from "@playwright/test";
import { test, expect, fakeRecording, AvatarPage } from "./fixtures";

// e2e/config/providers.yaml sends wake word audio to the fake local Whisper and speech to the
// fake OpenAI, and cuts wake word recordings 2 s after their sound starts, starting the next
// one 1 s earlier.

/** Changes what /api/wakeword returns to this page */
async function routeWakeWord(page: Page, change: Record<string, unknown>) {
  await page.route("**/api/wakeword", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), ...change } });
  });
}

/**
 * Makes a sound with no words that lasts soundMs, and says the phrase over phraseMs, phraseAt
 * after the sound starts. The recording that hears the sound start is cut 2 s in, and the
 * next one starts 1 s in. Returns which recording that is.
 */
function sayDuringSound(avatar: AvatarPage, soundMs: number, phrase: string, phraseAt: number, phraseMs: number) {
  return avatar.page.evaluate(
    async ([soundMs, phrase, phraseAt, phraseMs]) => {
      const first = window.__recordings().length - 1;
      const soundStart = Date.now();
      window.__speak("", soundMs);
      await new Promise((resolve) => setTimeout(resolve, phraseAt));
      window.__speak(phrase, phraseMs);
      return { first, soundStart };
    },
    [soundMs, phrase, phraseAt, phraseMs] as const
  );
}

test.describe("Wake word audio", () => {
  test("stays on this machine, and only what's said after the wake word reaches OpenAI", async ({ avatar, mock }) => {
    await avatar.hear("what time is it");
    await avatar.wakeUp();
    await avatar.hear("tell me a joke");
    await avatar.waitForPost("/api/chat");

    const local = await mock.localTranscriptions();
    expect(local.map((recording) => recording.text)).toEqual(["what time is it", "hey mira"]);
    // The OpenAI key stays with OpenAI
    expect(local.every((recording) => recording.auth === undefined)).toBe(true);
    expect(local[0]).toMatchObject({ model: "Systran/faster-whisper-small", language: "en" });
    expect((await mock.transcriptions()).map((recording) => recording.text)).toEqual(["tell me a joke"]);
  });

  test("fails without trying OpenAI while local Whisper is down, and wakes once it's back", async ({ avatar, mock }) => {
    await mock.setLocalWhisper({ down: true });

    for (const text of ["hey mira", "what time is it"]) {
      const failed = avatar.page.waitForResponse("**/api/stt");
      await avatar.say(text);
      expect((await failed).status()).toBe(503);
    }

    await avatar.waitForLog("Whisper API error");
    const reason = avatar.page.getByText("Wake word: Local Whisper can't be reached.");
    await expect(reason).toBeVisible();
    await expect(avatar.page.getByText('Say "Hey Mira"').first()).toBeVisible();
    expect(await mock.localTranscriptions()).toEqual([
      { kind: "local-stt", refused: true },
      { kind: "local-stt", refused: true },
    ]);
    expect(await mock.transcriptions()).toEqual([]);

    await mock.setLocalWhisper({ down: false });
    await avatar.wakeUp();
    await expect(reason).toBeHidden();
    expect(await mock.transcriptions()).toEqual([]);
  });

  // speaches 0.9.0-rc.3 answers 30 s or more of sound without speech with a 500
  test("takes local Whisper's crash on a recording without speech as nothing said", async ({ avatar, mock }) => {
    const answered = avatar.page.waitForResponse("**/api/stt");
    await avatar.say("NO_SPEECH");

    const response = await answered;
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ transcript: "" });
    await avatar.waitForLog("Whisper returned empty transcript");
    expect(await mock.localSpeechChecks()).toEqual([
      { kind: "local-vad", threshold: "0.5", minSilenceDurationMs: "160", maxSpeechDurationS: "30", speechPadMs: "400", text: "NO_SPEECH" },
    ]);
    await expect(avatar.page.getByText(/^Wake word:/)).toBeHidden();

    await avatar.wakeUp();
    expect(await mock.transcriptions()).toEqual([]);
  });

  test("wakes on the phrase of the character picked on /control, and not on Mira's", async ({ avatar, control }) => {
    await control.selectCharacter("Luna");
    await expect(avatar.page.getByText('Say "Hey Luna"').first()).toBeVisible();

    await avatar.hear("hey mira");
    await avatar.page.waitForTimeout(500);
    await expect(avatar.page.getByText("In Conversation")).toBeHidden();

    await avatar.hear("hey luna");
    await expect(avatar.page.getByText("In Conversation")).toBeVisible();
  });

  test("wakes on the picked character's phrase after a reload", async ({ page, request }) => {
    await request.put("/api/settings", { data: { characterId: "sora" } });
    const avatar = new AvatarPage(page);
    await avatar.open();

    await expect(page.getByText('Say "Hey Sora"').first()).toBeVisible();
    await avatar.hear("hey sora");
    await expect(page.getByText("In Conversation")).toBeVisible();
  });

  test("cuts long sound, so a wake word said at the cut is whole in the next recording", async ({ avatar, mock }) => {
    await expect.poll(() => avatar.isListening()).toBe(true);

    // The phrase starts 0.5 s before the first cut and ends 0.5 s after it
    const { first, soundStart } = await sayDuringSound(avatar, 2600, "hey mira", 1500, 1000);

    await expect(avatar.page.getByText("In Conversation")).toBeVisible();
    const [cut, next] = (await avatar.recordings()).slice(first);
    expect(cut.stoppedAt! - soundStart).toBeLessThan(2600);
    expect(cut.words).not.toContain("mira");
    expect(next.startedAt).toBeLessThan(cut.stoppedAt!);
    expect(next.words).toBe("hey mira");
    expect((await mock.localTranscriptions()).map((recording) => recording.text)).toContain("hey mira");
    await avatar.page.waitForTimeout(500);
    expect(await mock.transcriptions()).toEqual([]);
  });

  test("ignores the copy of the wake word that the overlapping recording heard", async ({ avatar, mock }) => {
    // Slow enough that the second recording is sent before the wake word comes back
    await mock.setLocalWhisper({ ms: 1500 });
    await expect.poll(() => avatar.isListening()).toBe(true);

    // The phrase is said while both recordings run, and the sound ends before the wake word
    // comes back, or what follows it would rightly go to OpenAI
    await sayDuringSound(avatar, 2600, "hey mira", 1200, 600);

    await expect(avatar.page.getByText("In Conversation")).toBeVisible();
    await avatar.waitForLog("Ignoring a recording from before the wake word");
    const heard = (await mock.localTranscriptions()).map((recording) => recording.text);
    expect(heard.filter((text) => text === "hey mira")).toHaveLength(2);
    await avatar.page.waitForTimeout(500);
    expect(avatar.postsTo("/api/chat")).toEqual([]);
    expect(await mock.transcriptions()).toEqual([]);
  });

  test("answers what was said before the wake word came back, without sending it to OpenAI", async ({ avatar, mock }) => {
    await mock.setLocalWhisper({ ms: 1500 });

    await avatar.say("hey mira");
    await avatar.waitForPost("/api/stt");
    await avatar.say("tell me a joke");

    await avatar.waitForPost("/api/chat");
    expect(avatar.postsTo("/api/chat")[0].messages).toEqual([{ role: "user", content: "tell me a joke" }]);
    expect((await mock.localTranscriptions()).map((recording) => recording.text)).toEqual([
      "hey mira",
      "tell me a joke",
    ]);
    expect(await mock.transcriptions()).toEqual([]);
  });

  test("swaps a recording that heard nothing for the next one, on the same mic and without a gap", async ({ page, mock }) => {
    // Recordings that hear nothing last up to silenceDetection.maxRecordingDuration
    await page.route("**/api/stt/config", async (route) => {
      const response = await route.fetch();
      const config = await response.json();
      const silenceDetection = { ...config.silenceDetection, maxRecordingDuration: 1000 };
      await route.fulfill({ response, json: { ...config, silenceDetection } });
    });
    const avatar = new AvatarPage(page);
    await avatar.open();

    await expect.poll(async () => (await avatar.recordings()).length).toBeGreaterThanOrEqual(4);

    const recordings = await avatar.recordings();
    for (let i = 1; i < recordings.length; i++) {
      expect(recordings[i].startedAt).toBeLessThanOrEqual(recordings[i - 1].stoppedAt!);
    }
    expect(await avatar.micRequests()).toBe(1);
    expect(await avatar.liveRecorders()).toBe(1);
    expect(await mock.localTranscriptions()).toEqual([]);
  });

  test("keeps a recording local if the conversation ends during it", async ({ page, mock }) => {
    await routeWakeWord(page, { timeout: 2 });
    const avatar = new AvatarPage(page);
    await avatar.open();
    await avatar.wakeUp();

    // Outlasts the conversation, which started recording it
    await avatar.say("are you still there", 3000);

    await expect(page.getByText('Say "Hey Mira"').first()).toBeVisible();
    await expect
      .poll(async () => (await mock.localTranscriptions()).map((recording) => recording.text))
      .toContainEqual(expect.stringMatching(/^are/));
    await page.waitForTimeout(500);
    expect(await mock.transcriptions()).toEqual([]);
  });

  test("sends everything to stt.provider with the wake word off", async ({ page, mock }) => {
    await routeWakeWord(page, { enabled: false });
    const avatar = new AvatarPage(page);
    await avatar.open();

    await avatar.hear("tell me a joke");

    await avatar.waitForPost("/api/chat");
    expect((await mock.transcriptions()).map((recording) => recording.text)).toEqual(["tell me a joke"]);
    expect(await mock.localTranscriptions()).toEqual([]);
  });

  test("keeps everything local, and from the LLM, without the wake word config", async ({ page, mock }) => {
    await page.route("**/api/wakeword", (route) => route.fulfill({ status: 500, json: { error: "test failure" } }));
    const avatar = new AvatarPage(page);
    await avatar.open();

    await avatar.hear("hey mira");
    await avatar.hear("tell me a joke");

    await page.waitForTimeout(1000);
    expect((await mock.localTranscriptions()).map((recording) => recording.text)).toEqual([
      "hey mira",
      "tell me a joke",
    ]);
    expect(await mock.transcriptions()).toEqual([]);
    expect(avatar.postsTo("/api/chat")).toEqual([]);
  });

  // The STT config says where to cut recordings while waiting
  test("opens the mic only once the STT config has loaded", async ({ page }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/stt/config", async (route) => {
      await held;
      await route.continue();
    });
    const avatar = new AvatarPage(page);
    const opened = avatar.open();
    await avatar.waitForLog("[VisionCompanion] Camera started");

    await page.waitForTimeout(1000);
    expect(await avatar.micRequests()).toBe(0);

    release();
    await opened;
    await avatar.waitForLog("[AudioRecorder] Started recording");
    expect(await avatar.micRequests()).toBe(1);
  });
});

test.describe("/api/stt", () => {
  async function transcribe(request: Page["request"], fields: Record<string, string>) {
    return request.post("/api/stt", {
      multipart: {
        audio: { name: "audio.webm", mimeType: "audio/webm", buffer: fakeRecording("hey mira") },
        language: "en",
        ...fields,
      },
    });
  }

  test("sends wake word audio to local Whisper, without the OpenAI key", async ({ request, mock }) => {
    const response = await transcribe(request, { purpose: "wakeWord" });

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ transcript: "hey mira" });
    // Nothing else, so no Authorization header either
    expect(await mock.localTranscriptions()).toEqual([
      {
        kind: "local-stt",
        model: "Systran/faster-whisper-small",
        language: "en",
        audio: expect.objectContaining({ name: "audio.webm" }),
        text: "hey mira",
      },
    ]);
    expect(await mock.transcriptions()).toEqual([]);
  });

  test("fails rather than use OpenAI while local Whisper is down", async ({ request, mock }) => {
    await mock.setLocalWhisper({ down: true });

    const response = await transcribe(request, { purpose: "wakeWord" });

    expect(response.status()).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ code: "unavailable", service: "localWhisper" });
    expect(body.error).toContain("Failed to connect to local Whisper server");
    expect(await mock.transcriptions()).toEqual([]);
  });

  test("refuses a recording without a purpose", async ({ request, mock }) => {
    const response = await transcribe(request, {});

    expect(response.status()).toBe(400);
    expect(await mock.localTranscriptions()).toEqual([]);
    expect(await mock.transcriptions()).toEqual([]);
  });
});
