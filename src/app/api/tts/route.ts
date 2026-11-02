import { NextRequest, NextResponse } from "next/server";
import { loadProvidersConfig } from "@/lib/providers/config-loader";
import type { TTSProviderConfig } from "@/lib/providers/types";
import { getLocale } from "@/lib/app";
import {
  ELEVENLABS_MODEL,
  ELEVENLABS_VOICE_ID,
  elevenLabsError,
  getElevenLabsApiKey,
  getElevenLabsBaseUrl,
} from "@/lib/tts/elevenlabs";

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

async function generateElevenLabsTTS(
  text: string,
  voiceId: string,
  config: TTSProviderConfig["elevenlabs"]
): Promise<string> {
  const response = await fetch(
    `${getElevenLabsBaseUrl(config)}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": getElevenLabsApiKey(), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: config?.model || ELEVENLABS_MODEL,
        // Sets the language for the voice and for how numbers and dates are read
        language_code: getLocale(),
      }),
      signal: AbortSignal.timeout(ELEVENLABS_TIMEOUT_MS),
    }
  );

  if (!response.ok) {
    throw await elevenLabsError(response);
  }

  const audioBuffer = await response.arrayBuffer();
  return Buffer.from(audioBuffer).toString("base64");
}

export async function POST(request: NextRequest) {
  try {
    const { text, voice } = await request.json();

    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const ttsConfig = loadProvidersConfig().providers.tts;
    if (ttsConfig?.provider && ttsConfig.provider !== "elevenlabs") {
      console.warn(`[TTS] Unknown tts.provider "${ttsConfig.provider}", using ElevenLabs`);
    }

    const spokenText = toSpokenText(text);
    if (!spokenText) {
      console.log("[TTS] Nothing to say once emoji and markdown are removed");
      return NextResponse.json({ audio: null });
    }

    // The voice picked on /control, then the configured one
    const voiceId = (typeof voice === "string" && voice) || ttsConfig?.elevenlabs?.voiceId || ELEVENLABS_VOICE_ID;
    console.log(`[TTS] Using ElevenLabs (voice: ${voiceId})`);
    const audioBase64 = await generateElevenLabsTTS(spokenText, voiceId, ttsConfig?.elevenlabs);

    return NextResponse.json({ audio: audioBase64 });
  } catch (error) {
    console.error("TTS API error:", error);
    return NextResponse.json(
      { error: "Failed to generate audio" },
      { status: 500 }
    );
  }
}
