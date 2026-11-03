import { NextResponse } from "next/server";
import { getSTTClientConfig } from "@/lib/providers/stt";
import { serviceErrorResponse } from "@/lib/errors/classify";

/**
 * GET /api/stt/config
 * Returns client-safe STT configuration for the frontend
 *
 * Response:
 * - enabled: boolean - Whether STT is enabled
 * - provider: string - Current provider (openai or local)
 * - silenceDetection: object - Silence detection settings
 * - wakeWord: object - How recordings are cut while waiting for the wake word
 * - language: string - Language code for transcription
 *
 * On failure: error and code. The page then records nothing, and says why.
 */
export async function GET() {
  try {
    const config = getSTTClientConfig();

    return NextResponse.json(config);
  } catch (error) {
    return serviceErrorResponse(error, "STT Config API");
  }
}
