import { NextResponse } from "next/server";
import { getWakeWordConfig } from "@/lib/character";

export async function GET() {
  try {
    const config = getWakeWordConfig();
    return NextResponse.json(config);
  } catch (error) {
    console.error("[WakeWord API] Error:", error);
    // No fallback: one with the wake word off would send everything heard to stt.provider
    return NextResponse.json({ error: "Failed to load the wake word config" }, { status: 500 });
  }
}
