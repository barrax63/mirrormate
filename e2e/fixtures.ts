import path from "node:path";
import { test as base, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

export { expect };

export const EN_URL = "http://127.0.0.1:3100";
export const JA_URL = "http://127.0.0.1:3101";
export const JAPANESE = /[぀-ヿ㐀-鿿]/;
export const JPEG_DATA_URL = /^data:image\/jpeg;base64,/;

const MOCK_URL = "http://127.0.0.1:11555";

// See fake-mic.js, speech-recognition-stub.js and audio-spy.js
declare global {
  interface Window {
    __micListening: () => boolean;
    __liveRecorders: () => number;
    __speak: () => boolean;
    __recognitions: { lang: string; running: boolean }[];
    __say: (text: string) => boolean;
    __recognitionFailure?: string | null;
    __endRecognition: () => void;
    __audioContexts: AudioContext[];
    __audioLinks: number;
  }
}

/** Keeps a run independent of outside services, such as the fonts in globals.css */
export async function blockOutsideRequests(context: BrowserContext) {
  await context.route(
    (url) => url.protocol.startsWith("http") && url.hostname !== "127.0.0.1",
    (route) => route.abort()
  );
}

/** Records console output, uncaught errors and API calls of one page */
class RecordedPage {
  readonly logs: string[] = [];
  readonly errors: string[] = [];
  private readonly posts: { path: string; body: Record<string, unknown> }[] = [];

  constructor(readonly page: Page) {
    page.on("console", (message) => this.logs.push(message.text()));
    page.on("pageerror", (error) => this.errors.push(error.message));
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (request.method() === "POST" && pathname.startsWith("/api/")) {
        // /api/stt sends a recording, not JSON
        const isJson = request.headers()["content-type"]?.includes("application/json");
        this.posts.push({ path: pathname, body: isJson ? request.postDataJSON() : {} });
      }
    });
  }

  /** Request bodies of the POSTs to this API path, oldest first */
  postsTo(path: string) {
    return this.posts.filter((post) => post.path === path).map((post) => post.body);
  }

  async waitForLog(text: string, timeout = 10_000) {
    await expect.poll(() => this.logs.some((log) => log.includes(text)), { timeout }).toBe(true);
  }

  async waitForPost(path: string, count = 1, timeout = 10_000) {
    await expect.poll(() => this.postsTo(path).length, { timeout }).toBeGreaterThanOrEqual(count);
  }
}

export class AvatarPage extends RecordedPage {
  async open() {
    await this.page.goto("/", { waitUntil: "networkidle" });
    await this.waitForLog("[VisionCompanion] Camera started");
    // Browsers only start an AudioContext after a click
    await this.page.mouse.click(5, 5);
  }

  /** Speaks into the mic once it's listening, and waits for the mock to transcribe it as this text */
  async hear(text: string) {
    await new MockBackends(this.page.request).queueTranscript(text);
    const transcribed = this.page.waitForResponse("**/api/stt");
    await expect.poll(() => this.page.evaluate(() => window.__speak()), { timeout: 10_000 }).toBe(true);
    expect((await transcribed).ok()).toBe(true);
  }

  /** Says the wake word and waits for the conversation to start */
  async wakeUp() {
    await this.hear("hey mira");
    await expect(this.page.getByText("In Conversation")).toBeVisible();
  }

  isListening() {
    return this.page.evaluate(() => window.__micListening());
  }

  liveRecorders() {
    return this.page.evaluate(() => window.__liveRecorders());
  }

  liveVideoTracks() {
    return this.page.evaluate(() => {
      const stream = document.querySelector("video")?.srcObject as MediaStream | null | undefined;
      return stream?.getVideoTracks().filter((track) => track.readyState === "live").length ?? 0;
    });
  }
}

/** The avatar page listening through the stub in speech-recognition-stub.js */
export class WebSpeechAvatarPage extends AvatarPage {
  /** Passes speech to the recognizer, waiting until one is listening */
  async hear(text: string) {
    await expect
      .poll(() => this.page.evaluate((said) => window.__say(said), text), { timeout: 10_000 })
      .toBe(true);
  }

  isListening() {
    return this.page.evaluate(() => window.__recognitions.some((r) => r.running));
  }

  /** Delays of the recognition restarts so far, oldest first */
  restartDelays() {
    return this.logs.flatMap((log) => {
      const delay = log.match(/Restarting in (\d+)ms/)?.[1];
      return delay ? [Number(delay)] : [];
    });
  }

  recognitionStarts() {
    return this.logs.filter((log) => log.includes("Web Speech started")).length;
  }

  recognitionLanguage() {
    return this.page.evaluate(() => window.__recognitions.at(-1)?.lang);
  }
}

export class ControlPage extends RecordedPage {
  async open() {
    await this.page.goto("/control", { waitUntil: "networkidle" });
  }

  async send(text: string) {
    const input = this.page.locator("form input");
    await input.fill(text);
    await input.press("Enter");
  }

  async selectMockVoice() {
    await this.page.getByRole("button", { name: "Select voice" }).click();
    await this.page.getByText("Mock").first().click();
  }

  async turnVisionOff() {
    await this.page.getByRole("button", { name: "Vision ON" }).click();
    await expect(this.page.getByRole("button", { name: "Vision OFF" })).toBeVisible();
  }
}

interface LoggedRequest {
  kind: "llm" | "vlm" | "extraction" | "embed" | "tts" | "unknown";
  auth?: string;
  path?: string;
  query?: string;
  body: {
    messages: { role: string; content: string; images?: string[] }[];
    tools?: { function: { name: string } }[];
  };
}

interface LoggedTranscription {
  auth: string;
  model: string;
  language: string;
  audio: { name: string; bytes: number; header: string };
}

export class MockBackends {
  constructor(private readonly request: APIRequestContext) {}

  async reset() {
    await this.request.post(`${MOCK_URL}/__reset`);
  }

  /** Sets the length of the audio that the fake VOICEVOX returns */
  async setAudioLength(ms: number) {
    await this.request.post(`${MOCK_URL}/__audio?ms=${ms}`);
  }

  async log(kind: LoggedRequest["kind"]): Promise<LoggedRequest[]> {
    const response = await this.request.get(`${MOCK_URL}/__log`);
    const log: LoggedRequest[] = await response.json();
    return log.filter((entry) => entry.kind === kind);
  }

  /** LLM requests whose last user message is this one */
  async llmRequestsFor(userMessage: string) {
    const requests = await this.log("llm");
    return requests.filter(
      (request) => request.body.messages.findLast((m) => m.role === "user")?.content === userMessage
    );
  }

  /** Recordings that reached the fake OpenAI, oldest first */
  async transcriptions(): Promise<LoggedTranscription[]> {
    const response = await this.request.get(`${MOCK_URL}/__log`);
    const log: (LoggedTranscription & { kind: string })[] = await response.json();
    return log.filter((entry) => entry.kind === "stt");
  }

  /** Makes this the text of the next recording that reaches the fake OpenAI */
  async queueTranscript(text: string) {
    await this.request.post(`${MOCK_URL}/__transcript`, { data: { text } });
  }
}

export const test = base.extend<{
  mock: MockBackends;
  resetState: void;
  avatar: AvatarPage;
  control: ControlPage;
}>({
  context: async ({ context }, provide) => {
    await blockOutsideRequests(context);
    await context.addInitScript({ path: path.join(__dirname, "fake-mic.js") });
    await provide(context);
  },

  mock: async ({ request }, provide) => {
    await provide(new MockBackends(request));
  },

  // Tests share the mock's log and the apps' databases, so clear what would leak between them
  resetState: [
    async ({ mock, request }, provide) => {
      await mock.reset();
      await request.put("/api/settings", { data: { speakerId: null } });
      await provide();
    },
    { auto: true },
  ],

  avatar: async ({ context }, provide) => {
    const avatar = new AvatarPage(await context.newPage());
    await avatar.open();
    await provide(avatar);
  },

  // Depends on avatar so that page opens first: /control relies on it for the camera, mic and audio
  control: async ({ context, avatar: _avatar }, provide) => {
    const control = new ControlPage(await context.newPage());
    await control.open();
    await provide(control);
  },
});

/** For the tests of Web Speech itself: pages get the stub, and the config asks for Web Speech */
export const webSpeechTest = test.extend<{ avatar: WebSpeechAvatarPage }>({
  context: async ({ context }, provide) => {
    await context.addInitScript({ path: path.join(__dirname, "speech-recognition-stub.js") });
    await context.route("**/api/stt/config", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), provider: "web" } });
    });
    await provide(context);
  },

  avatar: async ({ context }, provide) => {
    const avatar = new WebSpeechAvatarPage(await context.newPage());
    await avatar.open();
    await provide(avatar);
  },
});
