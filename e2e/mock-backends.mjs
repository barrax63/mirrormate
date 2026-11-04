// Stands in for every external backend during e2e runs: OpenAI (LLM, transcription,
// embeddings, vision), ElevenLabs (speech, voices) and local Whisper (transcription, under
// /local-whisper). It records each request so tests can inspect it.
// Like the real API, the fake OpenAI rejects parameters that gpt-6-luna and gpt-transcribe
// don't accept.
//
// Words in the last user message choose what the fake LLM does:
//   CALL_LOOP     calls a tool every time it's offered one, so the route hits its iteration limit
//   CALL_EFFECT   calls show_effect once, then replies
//   CALL_CAMERA   calls see_camera once, then replies
//   EMPTY_REPLY   replies with no text, every time
//   REMEMBER_xyz  memory extraction stores a memory about xyz
//
// Like the real model, it only calls tools that the request offers.
//
// And in text for speech, QUOTA_EXCEEDED makes the fake ElevenLabs answer as it does when the
// account is out of credits.
//
// POST /__fail with { api, status, code, retryAfter } makes one backend answer every request with
// that error, in the real service's shape, until /__reset or a status of null. api is
// transcription or chat (OpenAI), speech (ElevenLabs) or localWhisper.
import fs from "node:fs";
import http from "node:http";

const PORT = 11555;

// Start each run with empty databases
const tmpDir = new URL("./.tmp/", import.meta.url);
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

const DEFAULT_AUDIO_MS = 50;
// Transcribing takes longer than opening the mic, so the next recording starts before the
// transcript arrives. Real OpenAI takes about 600 ms, and local Whisper about 1.2 s.
const TRANSCRIPTION_MS = 300;
// Recordings from e2e/fake-mic.js end with this, then the words said during them as JSON
const TRANSCRIPT_MARK = Buffer.from("\nMOCK-TRANSCRIPT:");
let audioMs = DEFAULT_AUDIO_MS;
let localWhisper = { down: false, ms: TRANSCRIPTION_MS };
let failures = {};
let log = [];
let toolCallCount = 0;

// Silent MPEG-1 Layer III frames at 128 kbps, 44.1 kHz and mono, the format the app asks
// ElevenLabs for. Each frame is 417 bytes (144 * 128000 / 44100) and 1152 samples long.
function mp3(ms) {
  const frames = Math.max(1, Math.ceil((ms / 1000) * (44100 / 1152)));
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0xc0]);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
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
  // Vision requests carry the image as a content part
  const hasImage = (message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url");
  if (messages.some(hasImage)) return "vlm";
  // Only the extraction prompts open by talking about extracting
  if (/extract|抽出/i.test(messages[0]?.content?.slice(0, 200) ?? "")) return "extraction";
  return "llm";
}

// Stores what the conversation mentions, as the real model does, except what the prompt lists
// as already stored: lines like "- [id] (knowledge) title: content"
function extractionReply(messages) {
  const prompt = messages.at(-1)?.content ?? "";
  const stored = new Set([...prompt.matchAll(/^- \[[^\]]+\] .*REMEMBER_(\w+)/gm)].map(([, topic]) => topic));
  const said = prompt
    .split("\n")
    .filter((line) => line.startsWith("**"))
    .join("\n");
  const memories = [];
  for (const [, topic] of said.matchAll(/REMEMBER_(\w+)/g)) {
    if (stored.has(topic)) continue;
    stored.add(topic);
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

function llmReply({ messages, tools }) {
  const user = messages.findLast((m) => m.role === "user")?.content ?? "";
  const toolResults = messages.filter((m) => m.role === "tool").map((m) => m.content);
  const offered = (name) => tools?.some((tool) => tool.function.name === name);

  if (user.includes("EMPTY_REPLY")) return reply("");
  if (user.includes("CALL_LOOP") && offered("show_effect")) return toolCall("show_effect", { effect: "hearts" });
  if (toolResults.length > 0) return reply(`mock reply after tool: ${toolResults.join(" | ")}`);
  if (user.includes("CALL_EFFECT") && offered("show_effect")) return toolCall("show_effect", { effect: "confetti" });
  if (user.includes("CALL_CAMERA") && offered("see_camera")) return toolCall("see_camera", { focus: "their hands" });
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

// What was said during a recording, or nothing for one without the mark
function heardIn(audio) {
  const at = audio.lastIndexOf(TRANSCRIPT_MARK);
  if (at === -1) return "";
  try {
    return JSON.parse(audio.subarray(at + TRANSCRIPT_MARK.length).toString());
  } catch {
    return "";
  }
}

async function readUpload(req, raw) {
  const form = await new Response(raw, { headers: { "Content-Type": req.headers["content-type"] } }).formData();
  const file = form.get("file");
  const audio = Buffer.from(await file.arrayBuffer());
  const description = {
    name: file.name,
    bytes: audio.length,
    header: audio.subarray(0, 4).toString("hex"),
    webmFiles: countWebmFiles(audio),
  };
  return { form, audio, description };
}

// OpenAI's error shapes. A 429 is a rate limit, or no credit with code insufficient_quota, or a
// spending limit with project_spend_limit_exceeded or organization_spend_limit_exceeded.
function sendOpenAIFailure(res, { status, code, retryAfter }) {
  const [type, message] =
    status === 401
      ? ["invalid_request_error", "Incorrect API key provided"]
      : status === 429
        ? code === "insufficient_quota"
          ? ["insufficient_quota", "You exceeded your current quota"]
          : code?.endsWith("_spend_limit_exceeded")
            ? ["requests", "Spend limit reached"]
            : ["requests", "Rate limit reached"]
        : ["server_error", "The server had an error while processing your request"];
  res.writeHead(status, { "Content-Type": "application/json", ...(retryAfter && { "retry-after": String(retryAfter) }) });
  res.end(
    JSON.stringify({
      error: { message: `mock: ${message}`, type, param: null, code: code ?? (status === 401 ? "invalid_api_key" : null) },
    })
  );
}

// Answers with what was said during the recording, in gpt-transcribe's shape
async function transcribe(req, res, raw) {
  const { form, audio, description } = await readUpload(req, raw);
  // The SDK sends arrays as repeated `name[]` fields, and the API also takes plain `name`
  const list = (name) => [...form.getAll(`${name}[]`), ...form.getAll(name)];
  const languages = list("languages");
  const responseFormat = form.get("response_format") ?? "json";
  const text = heardIn(audio);
  log.push({
    kind: "stt",
    auth: req.headers.authorization,
    model: form.get("model"),
    language: form.get("language"),
    languages,
    keywords: list("keywords"),
    responseFormat,
    audio: description,
    text,
  });

  if (failures.transcription) return sendOpenAIFailure(res, failures.transcription);
  if (form.get("language") && languages.length > 0) {
    return sendOpenAIError(res, "language", "language and languages can't be sent together");
  }
  if (!["json", "text"].includes(responseFormat)) {
    return sendOpenAIError(res, "response_format", `${responseFormat} isn't supported`);
  }

  const reply = { text, languages: languages.slice(0, 1).map((code) => ({ code })), usage: { type: "duration", seconds: 1 } };
  setTimeout(() => (responseFormat === "text" ? res.end(text) : sendJson(res, reply)), TRANSCRIPTION_MS);
}

// Answers like speaches, which serves the same route as OpenAI. While it's down, it drops the
// connection, as a stopped container would refuse it.
async function transcribeLocally(req, res, raw) {
  if (localWhisper.down) {
    log.push({ kind: "local-stt", refused: true });
    return req.socket.destroy();
  }

  const { form, audio, description } = await readUpload(req, raw);
  const text = heardIn(audio);
  log.push({
    kind: "local-stt",
    auth: req.headers.authorization,
    model: form.get("model"),
    language: form.get("language"),
    audio: description,
    text,
  });

  if (failures.localWhisper) return sendJson(res, { detail: "mock: failure" }, failures.localWhisper.status);
  setTimeout(() => sendJson(res, { text }), localWhisper.ms);
}

// ElevenLabs' error shape. 401 covers a wrong key and running out of credits alike.
function sendElevenLabsError(res, httpStatus, status, message) {
  sendJson(res, { detail: { status, message: `mock: ${message}` } }, httpStatus);
}

// The account's voices, unsorted as the real API returns them. They include the ones the
// characters in config/locales recommend.
const VOICES = [
  { voice_id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah - Mature, Reassuring, Confident" },
  { voice_id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily - Velvety Actress" },
  { voice_id: "mock-voice", name: "Mock - The configured voice" },
  { voice_id: "cgSgspJ2msm6clMCkdW9", name: "Jessica - Playful, Bright, Warm" },
];

function listVoices(req, res) {
  const apiKey = req.headers["xi-api-key"];
  log.push({ kind: "voices", apiKey });
  if (!apiKey) return sendElevenLabsError(res, 401, "invalid_api_key", "Invalid API key");
  return sendJson(res, { voices: VOICES, has_more: false, total_count: VOICES.length, next_page_token: null });
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
  if (failures.speech) {
    const { status, code } = failures.speech;
    const defaultCode = { 401: "invalid_api_key", 429: "too_many_concurrent_requests" }[status] ?? "internal_server_error";
    return sendElevenLabsError(res, status, code ?? defaultCode, "failure");
  }
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
      audioMs = DEFAULT_AUDIO_MS;
      localWhisper = { down: false, ms: TRANSCRIPTION_MS };
      failures = {};
      return sendJson(res, { ok: true });
    case "/__fail":
      failures = { ...failures, [body.api]: body.status ? body : undefined };
      return sendJson(res, failures);
    case "/__audio":
      audioMs = Number(url.searchParams.get("ms"));
      return sendJson(res, { audioMs });
    case "/__local-whisper":
      localWhisper = { ...localWhisper, ...body };
      return sendJson(res, localWhisper);

    // Local Whisper, and the route LocalWhisperProvider falls back to
    case "/local-whisper/v1/audio/transcriptions":
      return transcribeLocally(req, res, raw);
    case "/local-whisper/transcribe":
      if (localWhisper.down) return req.socket.destroy();
      return sendJson(res, { error: "mock: speaches has no such route" }, 404);

    // OpenAI
    case "/v1/chat/completions": {
      const kind = classifyChat(body.messages);
      log.push({ kind, auth: req.headers.authorization, body });
      if (failures.chat) return sendOpenAIFailure(res, failures.chat);
      const rejected = rejectedChatParam(body);
      if (rejected) return sendOpenAIError(res, ...rejected);
      if (kind === "vlm") return sendJson(res, reply("person holding a mug"));
      if (kind === "extraction") return sendJson(res, extractionReply(body.messages));
      return sendJson(res, llmReply(body));
    }
    case "/v1/audio/transcriptions":
      return transcribe(req, res, raw);
    case "/v1/embeddings": {
      log.push({ kind: "embed", auth: req.headers.authorization, body });
      // The real API also answers base64, which the SDK asks for unless told otherwise
      if (body.encoding_format !== "float") {
        return sendOpenAIError(res, "encoding_format", "this mock only answers float");
      }
      const input = Array.isArray(body.input) ? body.input : [body.input];
      return sendJson(res, {
        object: "list",
        data: input.map((text, index) => ({ object: "embedding", index, embedding: embed(String(text)) })),
        model: body.model,
        usage: { prompt_tokens: 0, total_tokens: 0 },
      });
    }

    // ElevenLabs
    case "/v2/voices":
      return listVoices(req, res);

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
