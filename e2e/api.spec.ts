import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "./fixtures";

async function chat(request: APIRequestContext, content: string, extra: Record<string, unknown> = {}) {
  const response = await request.post("/api/chat", {
    data: { messages: [{ role: "user", content }], withAudio: false, ...extra },
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
    expect(llm.body.tools?.map((tool) => tool.function.name)).toContain("show_effect");
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
    expect(vlm.body.messages.at(-1)?.images).toEqual(["QUJD"]);
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
    expect((await mock.log("embed")).length).toBeGreaterThan(0);
  });
});

test.describe("other APIs", () => {
  test("/api/tts synthesizes speech with VOICEVOX", async ({ request, mock }) => {
    const response = await request.post("/api/tts", { data: { text: "hello there" } });

    expect(response.status()).toBe(200);
    const { audio } = await response.json();
    expect(Buffer.from(audio, "base64").subarray(0, 4).toString()).toBe("RIFF");
    expect((await mock.log("tts")).map((call) => call.path)).toEqual(["/audio_query", "/synthesis"]);
  });

  test("/api/voicevox/speakers lists the voices", async ({ request }) => {
    const response = await request.get("/api/voicevox/speakers");

    expect(response.status()).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("Mock");
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

  test("/api/stt transcribes a recording with OpenAI", async ({ request, mock }) => {
    await mock.queueTranscript("hello from a file");

    const response = await request.post("/api/stt", {
      multipart: {
        audio: { name: "audio.webm", mimeType: "audio/webm", buffer: Buffer.from("not really audio") },
        language: "en",
      },
    });

    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ transcript: "hello from a file", language: "en" });
    const [recording] = await mock.transcriptions();
    expect(recording).toMatchObject({ auth: "Bearer e2e-dummy-key", model: "whisper-1", language: "en" });
  });

  test("/api/stt/config reports OpenAI in English", async ({ request }) => {
    const response = await request.get("/api/stt/config");

    expect(await response.json()).toMatchObject({ provider: "openai", language: "en" });
  });
});
