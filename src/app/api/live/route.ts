import { NextRequest, NextResponse } from "next/server";
import { createLiveSession, getLiveClientConfig } from "@/lib/live";
import { serviceErrorResponse } from "@/lib/errors/classify";

const DEFAULT_USER_ID = "default-user";

/**
 * GET /api/live
 * Whether live mode is on, and when the page closes a session
 */
export async function GET() {
  try {
    return NextResponse.json(getLiveClientConfig());
  } catch (error) {
    return serviceErrorResponse(error, "Live API");
  }
}

/**
 * POST /api/live
 * Creates a GPT-Live session for the avatar page's WebRTC offer.
 *
 * Request: { sdp: the browser's SDP offer, characterId?: the character picked on /control }
 * Response: { sdp: OpenAI's SDP answer }
 * On failure: error, and code and service saying why (see src/lib/errors/service-error.ts)
 */
export async function POST(request: NextRequest) {
  try {
    if (!getLiveClientConfig().enabled) {
      return NextResponse.json(
        { error: "Live mode is off. Set providers.live.enabled to true in providers.yaml.", code: "failed" },
        { status: 404 }
      );
    }

    const { sdp, characterId } = await request.json();
    if (typeof sdp !== "string" || !sdp.startsWith("v=")) {
      return NextResponse.json({ error: "Send the browser's SDP offer as 'sdp'.", code: "failed" }, { status: 400 });
    }

    const session = await createLiveSession({
      sdp,
      userId: DEFAULT_USER_ID,
      characterId: typeof characterId === "string" && characterId ? characterId : undefined,
    });
    console.log(`[Live] Session created: ${session.sessionId}`);
    return NextResponse.json({ sdp: session.sdp });
  } catch (error) {
    return serviceErrorResponse(error, "Live API", "openai");
  }
}
