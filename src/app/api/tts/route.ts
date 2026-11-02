import { NextRequest, NextResponse } from "next/server";
import { loadProvidersConfig } from "@/lib/providers/config-loader";
import type { TTSProviderConfig } from "@/lib/providers/types";
import { getLocale } from "@/lib/app";

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";
// Sarah, a premade voice that every account has
const ELEVENLABS_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
const ELEVENLABS_MODEL = "eleven_v4_turbo";
// The longest of 98 test replies took 5.1 s
const ELEVENLABS_TIMEOUT_MS = 20_000;

// Emoji, including the parts of sequences such as flags, skin tones and keycaps
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

/**
 * Removes emoji, list bullets, headings and the asterisks of bold and italics, which speech
 * engines may read out or pause on. The prompt asks for plain text, but replies still carry the
 * odd emoji. The page shows the reply as it is.
 */
function toSpokenText(text: string): string {
  return text
    .replace(EMOJI, "")
    .replace(/^[ \t]*(?:[-*+]|#{1,6})[ \t]+/gm, "")
    // Japanese bullets often have no space after them
    .replace(/^[ \t]*[•・][ \t]*/gm, "")
    .replace(/\*+/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,!?;:。、！？])/g, "$1")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
}

// Word replacements for natural Japanese TTS pronunciation
const PRONUNCIATION_MAP: Record<string, string> = {
  // Apps & Services
  "Discord": "ディスコード",
  "discord": "ディスコード",
  "Twitter": "ツイッター",
  "twitter": "ツイッター",
  "YouTube": "ユーチューブ",
  "youtube": "ユーチューブ",
  "Google": "グーグル",
  "google": "グーグル",
  "Apple": "アップル",
  "iPhone": "アイフォン",
  "Android": "アンドロイド",
  "LINE": "ライン",
  "Slack": "スラック",
  "Zoom": "ズーム",
  "Teams": "チームズ",
  // Tech terms
  "API": "エーピーアイ",
  "URL": "ユーアールエル",
  "AI": "エーアイ",
  "OK": "オーケー",
  "Wi-Fi": "ワイファイ",
  "WiFi": "ワイファイ",
  "Bluetooth": "ブルートゥース",
  // Common English
  "check": "チェック",
  "link": "リンク",
  "share": "シェア",
};

/**
 * Normalize text for better Japanese TTS pronunciation
 */
function normalizeForTTS(text: string): string {
  let normalized = text;

  for (const [english, japanese] of Object.entries(PRONUNCIATION_MAP)) {
    // Use word boundary matching to avoid partial replacements
    const regex = new RegExp(`\\b${english}\\b`, "gi");
    normalized = normalized.replace(regex, japanese);
  }

  return normalized;
}

async function generateElevenLabsTTS(
  text: string,
  config: TTSProviderConfig["elevenlabs"]
): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured");
  }

  const baseUrl = (config?.baseUrl || ELEVENLABS_BASE_URL).replace(/\/+$/, "");
  const voiceId = encodeURIComponent(config?.voiceId || ELEVENLABS_VOICE_ID);

  const response = await fetch(`${baseUrl}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: config?.model || ELEVENLABS_MODEL,
      // Sets the language for the voice and for how numbers and dates are read
      language_code: getLocale(),
    }),
    signal: AbortSignal.timeout(ELEVENLABS_TIMEOUT_MS),
  });

  if (!response.ok) {
    // A wrong key, a missing permission and running out of credits are all 401s, and only
    // detail.status tells them apart: invalid_api_key, missing_permissions, quota_exceeded
    const body = await response.json().catch(() => null);
    const status = body?.detail?.status;
    throw new Error(`ElevenLabs returned ${response.status}${status ? ` (${status})` : ""}`);
  }

  const audioBuffer = await response.arrayBuffer();
  return Buffer.from(audioBuffer).toString("base64");
}

async function generateVoicevoxTTS(
  text: string,
  speaker: number,
  baseUrl: string
): Promise<string> {
  // Step 1: Create audio query
  const queryResponse = await fetch(
    `${baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
    { method: "POST" }
  );

  if (!queryResponse.ok) {
    throw new Error(`VOICEVOX audio_query failed: ${queryResponse.status}`);
  }

  const query = await queryResponse.json();

  // Step 2: Synthesize audio
  const synthesisResponse = await fetch(
    `${baseUrl}/synthesis?speaker=${speaker}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    }
  );

  if (!synthesisResponse.ok) {
    throw new Error(`VOICEVOX synthesis failed: ${synthesisResponse.status}`);
  }

  const audioBuffer = await synthesisResponse.arrayBuffer();
  return Buffer.from(audioBuffer).toString("base64");
}

export async function POST(request: NextRequest) {
  try {
    const { text, speaker: speakerOverride } = await request.json();

    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const config = loadProvidersConfig();
    const ttsConfig = config.providers.tts;

    // Default to ElevenLabs if TTS config is not set
    const provider = ttsConfig?.provider || "elevenlabs";

    const spokenText = toSpokenText(text);
    if (!spokenText) {
      console.log("[TTS] Nothing to say once emoji and markdown are removed");
      return NextResponse.json({ audio: null });
    }

    let audioBase64: string;

    if (provider === "voicevox") {
      // Use override if provided, otherwise use config
      const speaker = speakerOverride ?? ttsConfig?.voicevox?.speaker ?? 3;
      const baseUrl = ttsConfig?.voicevox?.baseUrl || "http://localhost:50021";

      console.log(`[TTS] Using VOICEVOX (speaker: ${speaker}${speakerOverride !== undefined ? " [override]" : ""})`);
      // Normalize text for better Japanese pronunciation
      audioBase64 = await generateVoicevoxTTS(normalizeForTTS(spokenText), speaker, baseUrl);
    } else {
      if (provider !== "elevenlabs") {
        console.warn(`[TTS] Unknown tts.provider "${provider}", using ElevenLabs`);
      }
      // The speaker is a VOICEVOX ID, so it doesn't apply here
      console.log(`[TTS] Using ElevenLabs (voice: ${ttsConfig?.elevenlabs?.voiceId || ELEVENLABS_VOICE_ID})`);
      audioBase64 = await generateElevenLabsTTS(spokenText, ttsConfig?.elevenlabs);
    }

    return NextResponse.json({ audio: audioBase64 });
  } catch (error) {
    console.error("TTS API error:", error);
    return NextResponse.json(
      { error: "Failed to generate audio" },
      { status: 500 }
    );
  }
}
