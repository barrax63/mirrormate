import { NextResponse } from "next/server";
import { loadProvidersConfig } from "@/lib/providers/config-loader";
import { listVoices } from "@/lib/tts/elevenlabs";

/**
 * GET /api/voices
 * The ElevenLabs voices the voice selector offers, as loaded when the server started
 */
export async function GET() {
  try {
    const voices = await listVoices(loadProvidersConfig().providers?.tts?.elevenlabs);
    return NextResponse.json({ voices });
  } catch (error) {
    console.error("[Voices] Couldn't load ElevenLabs voices:", error);
    return NextResponse.json({ voices: [], error: "ElevenLabs voices unavailable" }, { status: 502 });
  }
}
