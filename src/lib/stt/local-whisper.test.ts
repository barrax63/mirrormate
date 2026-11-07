import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LocalWhisperProvider } from "./local-whisper";
import { ServiceError } from "../errors/service-error";

const BASE = "http://whisper:8000";

type Answer = Response | (() => never);

// Answers each route with the next answer queued for it, and records the requests
function serve(routes: Record<string, Answer[]>) {
  const requests: { url: string; form: FormData }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: FormData }) => {
      requests.push({ url, form: init.body });
      const answer = routes[url.slice(BASE.length)]?.shift();
      if (!answer) return new Response("not found", { status: 404 });
      return typeof answer === "function" ? answer() : answer;
    })
  );
  return requests;
}

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const crash = () => new Response("Internal Server Error", { status: 500 });
const refused = () => {
  throw new TypeError("fetch failed");
};

const transcribe = () =>
  new LocalWhisperProvider({ baseUrl: BASE, model: "Systran/faster-whisper-small" }).transcribe(Buffer.from("audio"), {
    language: "de",
  });

describe("LocalWhisperProvider", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns the transcript", async () => {
    const requests = serve({ "/v1/audio/transcriptions": [json({ text: "Hallo Mira" })] });

    expect(await transcribe()).toMatchObject({ transcript: "Hallo Mira" });
    expect(requests[0].form.get("model")).toBe("Systran/faster-whisper-small");
    expect(requests[0].form.get("language")).toBe("de");
  });

  // speaches 0.9.0-rc.3 does this for 30 s or more of sound without speech
  it("returns no text for a 500 when speaches' VAD finds no speech", async () => {
    const requests = serve({ "/v1/audio/transcriptions": [crash()], "/v1/audio/speech/timestamps": [json([])] });

    expect(await transcribe()).toEqual({ transcript: "" });
    const vad = requests.find((request) => request.url.endsWith("/v1/audio/speech/timestamps"))!;
    expect(Object.fromEntries([...vad.form.entries()].filter(([key]) => key !== "file"))).toEqual({
      threshold: "0.5",
      min_silence_duration_ms: "160",
      max_speech_duration_s: "30",
      speech_pad_ms: "400",
    });
  });

  it("reports a 500 when speaches' VAD finds speech", async () => {
    serve({ "/v1/audio/transcriptions": [crash()], "/v1/audio/speech/timestamps": [json([{ start: 0, end: 8000 }])] });

    await expect(transcribe()).rejects.toMatchObject({ code: "failed", service: "localWhisper" });
  });

  it("reports a 500 from a server without the VAD route", async () => {
    serve({ "/v1/audio/transcriptions": [crash()] });

    await expect(transcribe()).rejects.toBeInstanceOf(ServiceError);
  });

  it("doesn't ask the VAD about other errors", async () => {
    const requests = serve({ "/v1/audio/transcriptions": [new Response("no such model", { status: 404 })] });

    await expect(transcribe()).rejects.toMatchObject({ code: "failed", service: "localWhisper" });
    expect(requests.map((request) => request.url)).not.toContain(`${BASE}/v1/audio/speech/timestamps`);
  });

  it("says so when the server can't be reached", async () => {
    serve({ "/v1/audio/transcriptions": [refused], "/transcribe": [refused] });

    await expect(transcribe()).rejects.toMatchObject({ code: "unavailable", service: "localWhisper" });
  });
});
