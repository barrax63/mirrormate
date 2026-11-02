import path from "node:path";
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

  test("wakes on a transcript with punctuation, as Whisper writes it", async ({ avatar }) => {
    await avatar.hear("Hey, Mira!");

    await expect(avatar.page.getByText("In Conversation")).toBeVisible();
  });

  test("sends what it hears after the wake word and speaks the reply", async ({ avatar, mock }) => {
    await avatar.wakeUp();
    await avatar.hear("tell me a joke");

    await avatar.waitForPost("/api/tts");
    const [chat] = avatar.postsTo("/api/chat");
    expect(chat).toMatchObject({
      messages: [{ role: "user", content: "tell me a joke" }],
    });
    expect(chat.image).toMatch(JPEG_DATA_URL);
    expect(avatar.postsTo("/api/tts")[0].text).toBe("mock reply to: tell me a joke");

    await avatar.waitForLog("Audio playback ended");
    const [speech] = await mock.speech();
    expect(speech.body.text).toBe("mock reply to: tell me a joke");
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

  test("stops resending older turns once the history reaches the limit", async ({ avatar }) => {
    await avatar.wakeUp();
    for (const [i, question] of ["question 1", "question 2", "question 3"].entries()) {
      await avatar.hear(question);
      await expect.poll(() => avatar.logs.filter((log) => log.includes("Audio playback ended")).length).toBe(i + 1);
    }

    await avatar.hear("question 4");

    // e2e/config/providers.yaml sets the limit to 4. The last 4 would start at the reply to
    // question 2, which goes without its question.
    await avatar.waitForPost("/api/chat", 4);
    expect(avatar.postsTo("/api/chat")[3].messages).toEqual([
      { role: "user", content: "question 3" },
      { role: "assistant", content: "mock reply to: question 3" },
      { role: "user", content: "question 4" },
    ]);
  });

  test("pauses recognition while replying and restarts it afterwards", async ({ avatar, mock }) => {
    await mock.setAudioLength(1000);
    await avatar.wakeUp();

    await avatar.hear("say something long");
    await avatar.waitForLog("Audio playback started");
    expect(await avatar.isListening()).toBe(false);

    await avatar.waitForLog("Audio playback ended");
    await avatar.hear("still listening");
    await avatar.waitForPost("/api/chat", 2);
  });

  test("listens again while a recording is transcribed, so nothing said meanwhile is lost", async ({ avatar, mock }) => {
    await mock.setTranscriptionTime(2000);
    await mock.queueTranscript("what time is it");

    await expect.poll(() => avatar.page.evaluate(() => window.__speak())).toBe(true);
    await avatar.waitForPost("/api/stt");

    await expect.poll(() => avatar.isListening(), { timeout: 1000 }).toBe(true);
    // Still before the transcript, which takes 2 s
    expect(avatar.logs.filter((log) => log.includes("Whisper result"))).toEqual([]);
  });

  test("sends what it recorded to OpenAI, using the test key", async ({ avatar, mock }) => {
    await avatar.hear("hello");

    const [recording] = await mock.transcriptions();
    expect(recording).toMatchObject({ auth: "Bearer e2e-dummy-key", model: "gpt-transcribe", languages: ["en"] });
    // The start of every WebM file
    expect(recording.audio).toMatchObject({ name: "audio.webm", header: "1a45dfa3" });
    expect(recording.audio.bytes).toBeGreaterThan(1000);
  });

  test("ignores a recording that comes back empty", async ({ avatar }) => {
    await avatar.wakeUp();

    await avatar.hear("");
    await avatar.page.waitForTimeout(1000);
    expect(avatar.postsTo("/api/chat")).toEqual([]);

    await avatar.hear("still listening");
    await avatar.waitForPost("/api/chat");
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
