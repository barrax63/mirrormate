// Stands in for every external backend during e2e runs: OpenAI (LLM, transcription),
// ElevenLabs (speech), Ollama (VLM, embeddings) and VOICEVOX. It records each request so
// tests can inspect it.
// Like the real API, the fake OpenAI rejects parameters that gpt-6-luna and gpt-transcribe
// don't accept.
//
// Words in the last user message choose what the fake LLM does:
//   CALL_LOOP     calls a tool every time, so the route hits its iteration limit
//   CALL_EFFECT   calls show_effect once, then replies
//   CALL_CAMERA   calls see_camera once, then replies
//   REMEMBER_xyz  memory extraction stores a memory about xyz
//
// And in text for speech, QUOTA_EXCEEDED makes the fake ElevenLabs answer as it does when the
// account is out of credits.
import fs from "node:fs";
import http from "node:http";

const PORT = 11555;

// Start each run with empty databases
const tmpDir = new URL("./.tmp/", import.meta.url);
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

const DEFAULT_AUDIO_MS = 50;
// Transcribing takes longer than opening the mic, so the next recording starts before the
// transcript arrives. Real OpenAI takes about 600 ms.
const TRANSCRIPTION_MS = 300;
let audioMs = DEFAULT_AUDIO_MS;
let log = [];
let transcripts = [];
let toolCallCount = 0;

// Silent MPEG-1 Layer III frames at 128 kbps, 44.1 kHz and mono, the format the app asks
// ElevenLabs for. Each frame is 417 bytes (144 * 128000 / 44100) and 1152 samples long.
function mp3(ms) {
  const frames = Math.max(1, Math.ceil((ms / 1000) * (44100 / 1152)));
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0xc0]);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

// 16-bit mono WAV of a sine tone
function wav(ms) {
  const sampleRate = 8000;
  const samples = Math.round((ms / 1000) * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    buffer.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), 44 + i * 2);
  }
  return buffer;
}

// Texts with similar characters get similar vectors, so RAG finds them
function embed(text) {
  const vector = new Array(64).fill(0);
  for (let i = 0; i < text.length; i++) {
    vector[text.charCodeAt(i) % 64] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
  return vector.map((x) => x / norm);
}

const reply = (content) => ({
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
});

const toolCall = (name, args) => ({
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: `call_${++toolCallCount}`, type: "function", function: { name, arguments: JSON.stringify(args) } },
        ],
      },
      finish_reason: "tool_calls",
    },
  ],
});

function classifyChat(messages) {
  // Only the extraction prompts open by talking about extracting
  if (/extract|抽出/i.test(messages[0]?.content?.slice(0, 200) ?? "")) return "extraction";
  return "llm";
}

// Extraction prompts can quote stored memories, so each topic is only stored once
const rememberedTopics = new Set();

function extractionReply(messages) {
  const memories = [];
  for (const [, topic] of (messages.at(-1)?.content ?? "").matchAll(/REMEMBER_(\w+)/g)) {
    if (rememberedTopics.has(topic)) continue;
    rememberedTopics.add(topic);
    memories.push({
      kind: "knowledge",
      title: `mock memory ${topic}`,
      content: `The user mentioned REMEMBER_${topic}`,
      tags: [],
      importance: 0.8,
      confidence: 0.9,
    });
  }
  return reply(
    "```json\n" +
      JSON.stringify({ profileUpdates: [], memoriesToUpsert: memories, archiveCandidates: [] }) +
      "\n```"
  );
}

function llmReply(messages) {
  const user = messages.findLast((m) => m.role === "user")?.content ?? "";
  const toolResults = messages.filter((m) => m.role === "tool").map((m) => m.content);

  if (user.includes("CALL_LOOP")) return toolCall("show_effect", { effect: "hearts" });
  if (toolResults.length > 0) return reply(`mock reply after tool: ${toolResults.join(" | ")}`);
  if (user.includes("CALL_EFFECT")) return toolCall("show_effect", { effect: "confetti" });
  if (user.includes("CALL_CAMERA")) return toolCall("see_camera", { focus: "their hands" });
  return reply(`mock reply to: ${user}`);
}

function sendJson(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

// The real API's error shape. The messages aren't OpenAI's wording.
function sendOpenAIError(res, param, message) {
  sendJson(res, { error: { message: `mock: ${message}`, type: "invalid_request_error", param, code: null } }, 400);
}

// What gpt-6-luna rejects, or null
function rejectedChatParam(body) {
  if ("max_tokens" in body) return ["max_tokens", "use max_completion_tokens"];
  const reasoningOff = body.reasoning_effort === "none";
  if (body.tools && !reasoningOff) return ["tools", "function tools need reasoning_effort none"];
  if ("temperature" in body && !reasoningOff) return ["temperature", "temperature needs reasoning_effort none"];
  return null;
}

// Counts the WebM headers in an upload. Mixed recordings still start with one, so checking
// the start isn't enough.
function countWebmFiles(audio) {
  const header = Buffer.from("1a45dfa3", "hex");
  let count = 0;
  for (let at = audio.indexOf(header); at !== -1; at = audio.indexOf(header, at + 1)) count++;
  return count;
}

// Answers with the next queued transcript, or nothing for silence, in gpt-transcribe's shape
async function transcribe(req, res, raw) {
  const form = await new Response(raw, { headers: { "Content-Type": req.headers["content-type"] } }).formData();
  const file = form.get("file");
  const audio = Buffer.from(await file.arrayBuffer());
  // The SDK sends arrays as repeated `name[]` fields, and the API also takes plain `name`
  const list = (name) => [...form.getAll(`${name}[]`), ...form.getAll(name)];
  const languages = list("languages");
  const responseFormat = form.get("response_format") ?? "json";
  log.push({
    kind: "stt",
    auth: req.headers.authorization,
    model: form.get("model"),
    language: form.get("language"),
    languages,
    keywords: list("keywords"),
    responseFormat,
    audio: {
      name: file.name,
      bytes: audio.length,
      header: audio.subarray(0, 4).toString("hex"),
      webmFiles: countWebmFiles(audio),
    },
  });

  if (form.get("language") && languages.length > 0) {
    return sendOpenAIError(res, "language", "language and languages can't be sent together");
  }
  if (!["json", "text"].includes(responseFormat)) {
    return sendOpenAIError(res, "response_format", `${responseFormat} isn't supported`);
  }

  const text = transcripts.shift() ?? "";
  const reply = { text, languages: languages.slice(0, 1).map((code) => ({ code })), usage: { type: "duration", seconds: 1 } };
  setTimeout(() => (responseFormat === "text" ? res.end(text) : sendJson(res, reply)), TRANSCRIPTION_MS);
}

// ElevenLabs' error shape. 401 covers a wrong key and running out of credits alike.
function sendElevenLabsError(res, httpStatus, status, message) {
  sendJson(res, { detail: { status, message: `mock: ${message}` } }, httpStatus);
}

// Answers like ElevenLabs' text to speech, with silence as long as /__audio says
function speak(req, res, body, url, voiceId) {
  const apiKey = req.headers["xi-api-key"];
  log.push({
    kind: "elevenlabs",
    path: url.pathname,
    voiceId,
    outputFormat: url.searchParams.get("output_format"),
    apiKey,
    body,
  });

  if (!apiKey) return sendElevenLabsError(res, 401, "invalid_api_key", "Invalid API key");
  if (body.text?.includes("QUOTA_EXCEEDED")) return sendElevenLabsError(res, 401, "quota_exceeded", "out of credits");
  if ((body.text?.length ?? 0) > 10000) {
    return sendElevenLabsError(res, 400, "max_character_limit_exceeded", "text over 10000 characters");
  }

  res.writeHead(200, { "Content-Type": "audio/mpeg" });
  res.end(mp3(audioMs));
}

function handle(req, res, body, raw) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // ElevenLabs
  const speech = url.pathname.match(/^\/v1\/text-to-speech\/([^/]+)$/);
  if (speech && req.method === "POST") return speak(req, res, body, url, decodeURIComponent(speech[1]));

  switch (url.pathname) {
    // Test controls
    case "/__log":
      return sendJson(res, log);
    case "/__reset":
      log = [];
      transcripts = [];
      audioMs = DEFAULT_AUDIO_MS;
      return sendJson(res, { ok: true });
    case "/__audio":
      audioMs = Number(url.searchParams.get("ms"));
      return sendJson(res, { audioMs });
    case "/__transcript":
      transcripts.push(body.text);
      return sendJson(res, { queued: transcripts.length });

    // OpenAI
    case "/v1/chat/completions": {
      const kind = classifyChat(body.messages);
      log.push({ kind, auth: req.headers.authorization, body });
      const rejected = rejectedChatParam(body);
      if (rejected) return sendOpenAIError(res, ...rejected);
      if (kind === "extraction") return sendJson(res, extractionReply(body.messages));
      return sendJson(res, llmReply(body.messages));
    }
    case "/v1/audio/transcriptions":
      return transcribe(req, res, raw);

    // Ollama
    case "/api/chat":
      log.push({ kind: "vlm", body });
      return sendJson(res, { message: { role: "assistant", content: "person holding a mug" }, done: true });
    case "/api/embed": {
      log.push({ kind: "embed", body });
      const input = Array.isArray(body.input) ? body.input : [body.input];
      return sendJson(res, { model: body.model, embeddings: input.map((text) => embed(String(text))) });
    }
    case "/api/tags":
      return sendJson(res, { models: [] });

    // VOICEVOX
    case "/audio_query":
      log.push({ kind: "tts", path: url.pathname, query: url.searchParams.get("text") });
      return sendJson(res, { accent_phrases: [], speedScale: 1 });
    case "/synthesis":
      log.push({ kind: "tts", path: url.pathname });
      res.writeHead(200, { "Content-Type": "audio/wav" });
      return res.end(wav(audioMs));
    case "/speakers":
      return sendJson(res, [{ name: "Mock", speaker_uuid: "mock", styles: [{ name: "normal", id: 2 }] }]);

    case "/health":
      return sendJson(res, { status: "ok" });
    default:
      log.push({ kind: "unknown", path: url.pathname });
      return sendJson(res, { error: `mock: no route for ${url.pathname}` }, 404);
  }
}

http
  .createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      let body = {};
      try {
        body = JSON.parse(raw.toString());
      } catch {
        // Not every request has a JSON body
      }
      handle(req, res, body, raw);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`Mock backends on port ${PORT}`));
