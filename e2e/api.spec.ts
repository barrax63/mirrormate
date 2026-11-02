import type { APIRequestContext } from "@playwright/test";
import { test, expect, fakeRecording } from "./fixtures";

async function chat(request: APIRequestContext, content: string, extra: Record<string, unknown> = {}) {
  const response = await request.post("/api/chat", {
    data: { messages: [{ role: "user", content }], ...extra },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe("/api/chat", () => {
  test("gives the LLM tools and feature context when no rule matches", async ({ request, mock }) => {
    const body = await chat(request, "tell me something");

    expect(body.message).toBe("mock reply to: tell me something");
    const [llm] = await mock.llmRequestsFor("tell me something");
    expect(llm.auth).toBe("Bearer e2e-dummy-key");
    // The mock rejects max_tokens, and tools without reasoning_effort "none"
    expect(llm.body).toMatchObject({ reasoning_effort: "none", max_completion_tokens: 300 });
    expect(llm.body.tools?.map((tool) => tool.function.name)).toContain("show_effect");
    expect(llm.body.messages[0].content).toContain("read aloud by a speech engine");
    expect(llm.body.messages[0].content).toContain("[Current Information]\nCurrent time:");
  });

  test("gives the LLM no tools and the rule context when a rule matches", async ({ request, mock }) => {
    const body = await chat(request, "I'm home");

    expect(body.message).toBe("mock reply to: I'm home");
    expect(body.toolsUsed).toBe(false);
    const requests = await mock.llmRequestsFor("I'm home");
    expect(requests).toHaveLength(1);
    expect(requests[0].body.tools ?? []).toEqual([]);
    expect(requests[0].body.messages[0].content).toContain("[Information from Rule]\nCurrent time:");
    expect(requests[0].body.messages[0].content).not.toContain("[Current Information]");
  });

  test("sends the LLM only the latest messages, up to the configured limit", async ({ request, mock }) => {
    // user 1, assistant 2, ... user 99, the latest question
    const messages = Array.from({ length: 99 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: i === 98 ? "the latest question" : `message ${i + 1}`,
    }));

    const body = await chat(request, "", { messages });

    // e2e/config/providers.yaml sets the limit to 4. The cut would start at a reply, which goes too.
    expect(body.historyLimit).toBe(4);
    const [llm] = await mock.llmRequestsFor("the latest question");
    expect(llm.body.messages[0].role).toBe("system");
    expect(llm.body.messages.slice(1)).toEqual([
      { role: "user", content: "message 97" },
      { role: "assistant", content: "message 98" },
      { role: "user", content: "the latest question" },
    ]);
  });

  test("returns the effect from a tool call", async ({ request, mock }) => {
    const body = await chat(request, "CALL_EFFECT please");

    expect(body.effect).toBe("confetti");
    expect(body.toolsUsed).toBe(true);
    expect(body.message).toBe("mock reply after tool: Displaying confetti effect");
    expect(await mock.llmRequestsFor("CALL_EFFECT please")).toHaveLength(2);
  });

  test("stops calling the LLM after 3 iterations", async ({ request, mock }) => {
    const body = await chat(request, "CALL_LOOP please");

    expect(body.effect).toBe("hearts");
    expect(await mock.llmRequestsFor("CALL_LOOP please")).toHaveLength(3);
  });

  test("known bug: replies when the tool limit is reached", async ({ request }) => {
    const body = await chat(request, "CALL_LOOP again");

    test.fail(true, "The reply is empty, so the avatar says nothing");
    expect(body.message).not.toBe("");
  });

  test("sends the camera image to the VLM through see_camera", async ({ request, mock }) => {
    const image = "data:image/jpeg;base64,QUJD";

    const body = await chat(request, "CALL_CAMERA please", { image });

    expect(body.message).toBe("mock reply after tool: person holding a mug");
    const [vlm] = await mock.log("vlm");
    expect(vlm.auth).toBe("Bearer e2e-dummy-key");
    expect(vlm.body).toMatchObject({ model: "gpt-6-luna", reasoning_effort: "none" });
    expect(vlm.body.messages[0].content).toContainEqual({ type: "image_url", image_url: { url: image } });
  });

  test("drops the camera image while Vision is off", async ({ request, mock }) => {
    await request.put("/api/settings", { data: { visionEnabled: false } });

    await chat(request, "CALL_CAMERA please", { image: "data:image/jpeg;base64,QUJD" });

    expect(await mock.log("vlm")).toEqual([]);
    const [llm] = await mock.llmRequestsFor("CALL_CAMERA please");
    expect(llm.body.messages[0].content).not.toContain("[Tool Usage]");
  });

  test("extracts memories after replying and finds them in later requests", async ({ request, mock }) => {
    await chat(request, "my code is REMEMBER_canary");

    await expect
      .poll(async () => {
        const response = await request.get("/api/memories");
        const { memories } = await response.json();
        return memories.map((memory: { title: string }) => memory.title);
      })
      .toContain("mock memory canary");

    await chat(request, "what is REMEMBER_canary");

    const [llm] = await mock.llmRequestsFor("what is REMEMBER_canary");
    expect(llm.body.messages[0].content).toContain("The user mentioned REMEMBER_canary");
    const embeds = await mock.log("embed");
    expect(embeds.length).toBeGreaterThan(0);
    for (const embed of embeds) {
      expect(embed.auth).toBe("Bearer e2e-dummy-key");
      expect(embed.body).toMatchObject({ model: "text-embedding-3-small", encoding_format: "float" });
    }
  });
});

test.describe("other APIs", () => {
  test("/api/tts speaks with ElevenLabs in the configured voice, using the test key", async ({ request, mock }) => {
    const response = await request.post("/api/tts", { data: { text: "hello there" } });

    expect(response.status()).toBe(200);
    const { audio } = await response.json();
    // The start of an mp3 frame
    expect(Buffer.from(audio, "base64").subarray(0, 2).toString("hex")).toBe("fffb");
    const [speech] = await mock.speech();
    expect(speech).toMatchObject({
      path: "/v1/text-to-speech/mock-voice",
      outputFormat: "mp3_44100_128",
      apiKey: "e2e-dummy-key",
      body: { text: "hello there", model_id: "eleven_v4_turbo", language_code: "en" },
    });
  });

  test("/api/tts speaks in the voice it's given", async ({ request, mock }) => {
    await request.post("/api/tts", { data: { text: "hello there", voice: "pFZP5JQG7iQjIQuC4Bku" } });

    const [speech] = await mock.speech();
    expect(speech.path).toBe("/v1/text-to-speech/pFZP5JQG7iQjIQuC4Bku");
  });

  test("/api/tts leaves emoji and markdown out of speech", async ({ request, mock }) => {
    const response = await request.post("/api/tts", { data: { text: "**Great** news! 🎉\n- one\n- two" } });

    expect(response.status()).toBe(200);
    const [speech] = await mock.speech();
    expect(speech.body.text).toBe("Great news!\none\ntwo");
  });

  test("/api/tts returns no audio for a reply that's only emoji", async ({ request, mock }) => {
    const response = await request.post("/api/tts", { data: { text: "🎉👍" } });

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ audio: null });
    expect(await mock.speech()).toEqual([]);
  });

  test("/api/tts fails when ElevenLabs is out of credits", async ({ request, mock }) => {
    const response = await request.post("/api/tts", { data: { text: "QUOTA_EXCEEDED" } });

    expect(response.status()).toBe(502);
    expect(await response.json()).toEqual({
      error: "ElevenLabs returned 401 (quota_exceeded)",
      code: "quota_exceeded",
      service: "elevenlabs",
    });
    expect(await mock.speech()).toHaveLength(1);
  });

  test("/api/voices lists the account's voices by name, loaded once", async ({ request, mock }) => {
    await request.get("/api/voices");
    const loads = (await mock.log("voices")).length;

    const response = await request.get("/api/voices");

    expect(response.status()).toBe(200);
    expect((await response.json()).voices).toEqual([
      { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica - Playful, Bright, Warm" },
      { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily - Velvety Actress" },
      { id: "mock-voice", name: "Mock - The configured voice" },
      { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah - Mature, Reassuring, Confident" },
    ]);
    expect(await mock.log("voices")).toHaveLength(loads);
  });

  test("/api/settings keeps the character when the voice is saved, and the other way round", async ({ request }) => {
    await request.put("/api/settings", { data: { characterId: "luna" } });
    await request.put("/api/settings", { data: { voice: "pFZP5JQG7iQjIQuC4Bku" } });
    expect(await (await request.get("/api/settings")).json()).toEqual({
      voice: "pFZP5JQG7iQjIQuC4Bku",
      characterId: "luna",
      visionEnabled: true,
    });

    await request.put("/api/settings", { data: { characterId: "sora" } });
    await request.put("/api/settings", { data: { visionEnabled: false } });
    expect(await (await request.get("/api/settings")).json()).toEqual({
      voice: "pFZP5JQG7iQjIQuC4Bku",
      characterId: "sora",
      visionEnabled: false,
    });

    await request.put("/api/settings", { data: { voice: null } });
    expect(await (await request.get("/api/settings")).json()).toEqual({ voice: null, characterId: "sora", visionEnabled: false });
  });

  test("/api/settings ignores a Vision value that isn't true or false", async ({ request }) => {
    await request.put("/api/settings", { data: { visionEnabled: "off" } });

    expect((await (await request.get("/api/settings")).json()).visionEnabled).toBe(true);
  });

  test("/api/plugins includes the hidden vision plugin", async ({ request }) => {
    const response = await request.get("/api/plugins");

    expect(response.status()).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("vision-companion");
  });

  test("/api/wakeword returns the English phrase", async ({ request }) => {
    const response = await request.get("/api/wakeword");

    expect(await response.json()).toMatchObject({ enabled: true, phrase: "Hey Mira" });
  });

  test("/api/stt transcribes speech with OpenAI", async ({ request, mock }) => {
    const response = await request.post("/api/stt", {
      multipart: {
        audio: { name: "audio.webm", mimeType: "audio/webm", buffer: fakeRecording("hello from a file") },
        purpose: "speech",
        language: "en",
      },
    });

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ transcript: "hello from a file", language: "en", duration: 1 });
    const [recording] = await mock.transcriptions();
    expect(recording).toMatchObject({
      auth: "Bearer e2e-dummy-key",
      model: "gpt-transcribe",
      language: null,
      languages: ["en"],
      responseFormat: "json",
    });
    expect(recording.keywords).toEqual(expect.arrayContaining(["Mira", "Luna"]));
  });

  test("/api/stt/config reports OpenAI in English, and where wake word recordings are cut", async ({ request }) => {
    const response = await request.get("/api/stt/config");

    expect(await response.json()).toMatchObject({
      provider: "openai",
      language: "en",
      wakeWord: { maxRecordingDuration: 2000, overlap: 1000 },
    });
  });
});
