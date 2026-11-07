import { NextRequest, NextResponse } from "next/server";
import { getWakeWordConfig } from "@/lib/character";

/**
 * GET /api/wakeword?characterId=luna
 * The wake word config, with the phrase of the character picked on /control, given as characterId
 */
export async function GET(request: NextRequest) {
  try {
    const config = getWakeWordConfig(request.nextUrl.searchParams.get("characterId"));
    return NextResponse.json(config);
  } catch (error) {
    console.error("[WakeWord API] Error:", error);
    // No fallback: one with the wake word off would send everything heard to stt.provider
    return NextResponse.json({ error: "Failed to load the wake word config" }, { status: 500 });
  }
}
