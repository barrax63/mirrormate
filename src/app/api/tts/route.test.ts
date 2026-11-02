import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { TTSProviderConfig } from "@/lib/providers/types";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ tts: undefined as TTSProviderConfig | undefined }));

vi.mock("@/lib/providers/config-loader", () => ({
  loadProvidersConfig: () => ({ providers: { tts: mocks.tts } }),
}));

const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0xc0]);

let fetchMock: ReturnType<typeof vi.fn>;

async function speak(text: string, voice?: string) {
  const response = await POST(
    new NextRequest("http://localhost/api/tts", { method: "POST", body: JSON.stringify({ text, voice }) })
  );
  return { status: response.status, body: await response.json() };
}

/** What /api/tts sent to ElevenLabs */
function sent(call = 0) {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string), headers: init.headers as Record<string, string> };
}

describe("POST /api/tts with ElevenLabs", () => {
  beforeEach(() => {
    mocks.tts = undefined;
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubEnv("LOCALE", "en");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock = vi.fn().mockResolvedValue(new Response(MP3, { headers: { "Content-Type": "audio/mpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("asks for Sarah on eleven_v4_turbo as mp3 by default, in the server's language", async () => {
    vi.stubEnv("LOCALE", "ja");

    const { status, body } = await speak("こんにちは");

    expect(status).toBe(200);
    expect(body.audio).toBe(Buffer.from(MP3).toString("base64"));
    const { url, init, headers, body: request } = sent();
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL?output_format=mp3_44100_128");
    expect(headers["xi-api-key"]).toBe("test-key");
    expect(request).toEqual({ text: "こんにちは", model_id: "eleven_v4_turbo", language_code: "ja" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the configured voice, model and base URL", async () => {
    mocks.tts = {
      enabled: true,
      provider: "elevenlabs",
      elevenlabs: { voiceId: "voice/1", model: "eleven_flash_v2_5", baseUrl: "http://127.0.0.1:9999/" },
    };

    await speak("hello");

    expect(sent().url).toBe("http://127.0.0.1:9999/v1/text-to-speech/voice%2F1?output_format=mp3_44100_128");
    expect(sent().body.model_id).toBe("eleven_flash_v2_5");
  });

  it("uses the voice picked on /control over the configured one", async () => {
    mocks.tts = { enabled: true, provider: "elevenlabs", elevenlabs: { voiceId: "configured-voice" } };

    await speak("hello", "picked-voice");

    expect(sent().url).toBe("https://api.elevenlabs.io/v1/text-to-speech/picked-voice?output_format=mp3_44100_128");
  });

  it.each([
    ["**Great** news, *really*!", "Great news, really!"],
    ["- milk\n- eggs\n* flour\n+ sugar", "milk\neggs\nflour\nsugar"],
    ["## Pancakes\nMix it all.", "Pancakes\nMix it all."],
    ["・りんご\n・ みかん", "りんご\nみかん"],
    ["Done! 🎉", "Done!"],
    ["Wow 🎉 that's great 👍🏽!", "Wow that's great!"],
    ["Family 👨‍👩‍👧, Germany 🇩🇪, number 1️⃣", "Family, Germany, number 1"],
    ["合格おめでとう！🎉", "合格おめでとう！"],
    // What stays
    ["-5 degrees, from 9:15 - 10:00", "-5 degrees, from 9:15 - 10:00"],
    ["1. Preheat the pan", "1. Preheat the pan"],
    ["ジョン・スミスさん", "ジョン・スミスさん"],
  ])("speaks %j as %j", async (reply, spoken) => {
    await speak(reply);

    expect(sent().body.text).toBe(spoken);
  });

  it("returns no audio, without calling ElevenLabs, when only emoji are left", async () => {
    const { status, body } = await speak("🎉 👍");

    expect(status).toBe(200);
    expect(body).toEqual({ audio: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails without a key, without calling ElevenLabs", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");

    const { status, body } = await speak("hello");

    expect(status).toBe(500);
    expect(body).toMatchObject({ code: "missing_key", service: "elevenlabs" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs ElevenLabs' own reason when it refuses, and passes it on", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { detail: { status: "quota_exceeded", message: "This request exceeds your quota of 10000." } },
        { status: 401 }
      )
    );

    const { status, body } = await speak("hello");

    expect(status).toBe(502);
    expect(body).toEqual({
      error: "ElevenLabs returned 401 (quota_exceeded)",
      code: "quota_exceeded",
      service: "elevenlabs",
    });
    expect(String(vi.mocked(console.error).mock.calls[0][1])).toContain("ElevenLabs returned 401 (quota_exceeded)");
  });

  it("calls ElevenLabs unavailable when it can't be reached", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const { status, body } = await speak("hello");

    expect(status).toBe(503);
    expect(body).toMatchObject({ code: "unavailable", service: "elevenlabs" });
  });
});
