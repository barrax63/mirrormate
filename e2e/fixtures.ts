import path from "node:path";
import { test as base, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

export { expect };

export const EN_URL = "http://127.0.0.1:3100";
export const JA_URL = "http://127.0.0.1:3101";
export const JAPANESE = /[぀-ヿ㐀-鿿]/;
export const JPEG_DATA_URL = /^data:image\/jpeg;base64,/;

const MOCK_URL = "http://127.0.0.1:11555";

/** An error for a fake backend to answer with, see MockBackends.fail */
export interface Failure {
  status: 401 | 429 | 500 | 503 | null;
  code?: string;
  retryAfter?: number;
}

/** One recording made through fake-mic.js, with the words said during it */
export interface Recording {
  startedAt: number;
  stoppedAt: number | null;
  words: string;
}

// See fake-mic.js and audio-spy.js
declare global {
  interface Window {
    __micListening: () => boolean;
    __liveRecorders: () => number;
    __recordings: () => Recording[];
    __liveMicStreams: () => number;
    __micRequests: () => number;
    __cameraRequests: () => number;
    __liveCameraTracks: () => number;
    __micHeld?: boolean;
    __releaseMic: () => void;
    __speak: (text?: string, ms?: number) => boolean;
    __audioContexts: AudioContext[];
    __audioLinks: number;
  }
}

/**
 * A file for /api/stt that the fake transcription services read as this text, as they do
 * recordings made through fake-mic.js
 */
export function fakeRecording(transcript: string) {
  return Buffer.from(`not really audio\nMOCK-TRANSCRIPT:${JSON.stringify(transcript)}`);
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

  /** Says this into the mic once it's listening, and waits for the transcript, or the error with failing */
  async hear(text: string, { failing = false } = {}) {
    const transcribed = this.page.waitForResponse("**/api/stt");
    await this.say(text);
    expect((await transcribed).ok()).toBe(!failing);
  }

  /** Says this into the mic once it's listening, over this many milliseconds */
  async say(text: string, ms?: number) {
    await expect
      .poll(() => this.page.evaluate(([said, length]) => window.__speak(said, length), [text, ms] as const), {
        timeout: 10_000,
      })
      .toBe(true);
  }

  /** Every recording so far, oldest first */
  recordings() {
    return this.page.evaluate(() => window.__recordings());
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

  liveMicStreams() {
    return this.page.evaluate(() => window.__liveMicStreams());
  }

  micRequests() {
    return this.page.evaluate(() => window.__micRequests());
  }

  /** Lets the mic finish opening, with the micHeld option */
  async releaseMic() {
    await this.page.evaluate(() => window.__releaseMic());
    // Gives the page time to act on the open mic, which is what the tests check
    await this.page.waitForTimeout(500);
  }

  /** Live tracks of every camera stream this page opened */
  liveVideoTracks() {
    return this.page.evaluate(() => window.__liveCameraTracks());
  }

  cameraRequests() {
    return this.page.evaluate(() => window.__cameraRequests());
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

  /** Picks a voice from the selector by the start of its name, with none picked yet */
  async selectVoice(name: string) {
    await this.page.getByRole("button", { name: "Select voice" }).click();
    await this.page.getByText(name).first().click();
  }

  /** Picks a character by name, with none picked yet */
  async selectCharacter(name: string) {
    await this.page.getByRole("button", { name: "Select character" }).click();
    await this.page.getByText(name, { exact: true }).click();
  }

  async turnVisionOff() {
    await this.page.getByRole("button", { name: "Vision ON" }).click();
    await expect(this.page.getByRole("button", { name: "Vision OFF" })).toBeVisible();
  }
}

/** A part of a chat message, as vision requests send text and image together */
interface ContentPart {
  type: string;
  text?: string;
  image_url?: { url: string };
}

interface LoggedRequest {
  kind: "llm" | "vlm" | "extraction" | "embed" | "voices" | "unknown";
  auth?: string;
  path?: string;
  body: {
    model?: string;
    messages: { role: string; content: string | ContentPart[] }[];
    tools?: { function: { name: string } }[];
    reasoning_effort?: string;
    max_completion_tokens?: number;
    // Embedding requests
    input?: string | string[];
    encoding_format?: string;
  };
}

interface LoggedSpeech {
  path: string;
  voiceId: string;
  outputFormat: string | null;
  apiKey?: string;
  body: { text: string; model_id: string; language_code: string };
}

interface LoggedUpload {
  name: string;
  bytes: number;
  header: string;
  webmFiles: number;
}

interface LoggedTranscription {
  auth: string;
  model: string;
  language: string | null;
  languages: string[];
  keywords: string[];
  responseFormat: string;
  audio: LoggedUpload;
  /** What the mock answered: the words said during the recording */
  text: string;
}

interface LoggedLocalTranscription {
  /** Set for the requests that came while local Whisper was down, with nothing else */
  refused?: true;
  auth?: string;
  model: string;
  language: string | null;
  audio: LoggedUpload;
  text: string;
}

interface LoggedSpeechCheck {
  threshold: string;
  minSilenceDurationMs: string;
  maxSpeechDurationS: string;
  speechPadMs: string;
  text: string;
}

export class MockBackends {
  constructor(private readonly request: APIRequestContext) {}

  async reset() {
    await this.request.post(`${MOCK_URL}/__reset`);
  }

  /** Sets the length of the audio that the fake ElevenLabs returns */
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

  /** Recordings that reached the fake local Whisper, oldest first */
  async localTranscriptions(): Promise<LoggedLocalTranscription[]> {
    const response = await this.request.get(`${MOCK_URL}/__log`);
    const log: (LoggedLocalTranscription & { kind: string })[] = await response.json();
    return log.filter((entry) => entry.kind === "local-stt");
  }

  /** Recordings that the fake local Whisper's VAD was asked about, oldest first */
  async localSpeechChecks(): Promise<LoggedSpeechCheck[]> {
    const response = await this.request.get(`${MOCK_URL}/__log`);
    const log: (LoggedSpeechCheck & { kind: string })[] = await response.json();
    return log.filter((entry) => entry.kind === "local-vad");
  }

  /** Makes the fake local Whisper drop every connection, or take this long to answer */
  async setLocalWhisper(state: { down?: boolean; ms?: number }) {
    await this.request.post(`${MOCK_URL}/__local-whisper`, { data: state });
  }

  /**
   * Makes a backend answer every request with this error, as the real one does, until reset or
   * a status of null. code is OpenAI's error code, or ElevenLabs' detail.status.
   */
  async fail(api: "transcription" | "chat" | "speech" | "localWhisper", failure: Failure) {
    await this.request.post(`${MOCK_URL}/__fail`, { data: { api, ...failure } });
  }

  /** Speech requests that reached the fake ElevenLabs, oldest first */
  async speech(): Promise<LoggedSpeech[]> {
    const response = await this.request.get(`${MOCK_URL}/__log`);
    const log: (LoggedSpeech & { kind: string })[] = await response.json();
    return log.filter((entry) => entry.kind === "elevenlabs");
  }
}

export const test = base.extend<{
  micHeld: boolean;
  mock: MockBackends;
  resetState: void;
  avatar: AvatarPage;
  control: ControlPage;
}>({
  // Keeps the mic opening until the test calls avatar.releaseMic()
  micHeld: [false, { option: true }],

  context: async ({ context, micHeld }, provide) => {
    await blockOutsideRequests(context);
    await context.addInitScript({ path: path.join(__dirname, "fake-mic.js") });
    if (micHeld) {
      await context.addInitScript(() => {
        window.__micHeld = true;
      });
    }
    await provide(context);
  },

  mock: async ({ request }, provide) => {
    await provide(new MockBackends(request));
  },

  // Tests share the mock's log and the apps' databases, so clear what would leak between them
  resetState: [
    async ({ mock, request }, provide) => {
      await mock.reset();
      await request.put("/api/settings", { data: { voice: null, characterId: null, visionEnabled: true } });
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
