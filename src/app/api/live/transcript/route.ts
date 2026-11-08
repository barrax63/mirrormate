import { NextRequest, NextResponse } from "next/server";
import { getLiveMemoryService, type LiveMessage } from "@/lib/live";
import { serviceErrorResponse } from "@/lib/errors/classify";

const DEFAULT_USER_ID = "default-user";

const isMessage = (value: unknown): value is LiveMessage =>
  typeof value === "object" &&
  value !== null &&
  ((value as LiveMessage).role === "user" || (value as LiveMessage).role === "assistant") &&
  typeof (value as LiveMessage).content === "string";

/**
 * POST /api/live/transcript
 * The transcript of a finished GPT-Live session, which memory extraction reads as it reads a
 * conversation after /api/chat. Answers before the extraction is done.
 *
 * Request: { messages: [{ role: "user" | "assistant", content }] }
 */
export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json();
    if (!Array.isArray(messages) || !messages.every(isMessage)) {
      return NextResponse.json(
        { error: "Send the transcript as 'messages', each with a role of user or assistant and a content string.", code: "failed" },
        { status: 400 }
      );
    }

    // As /api/chat does: the most recent part of the conversation
    const conversation = messages.slice(-10);
    const memory = getLiveMemoryService();
    const extracted =
      memory !== null && conversation.some((m) => m.role === "user") && conversation.some((m) => m.role === "assistant");
    console.log(`[Live] Transcript of ${messages.length} turns${extracted ? ", extracting memories" : ""}`);
    if (extracted) {
      memory.processConversation(DEFAULT_USER_ID, conversation).catch((error) => {
        console.error("[Live] Memory extraction failed:", error);
      });
    }

    return NextResponse.json({ extracting: extracted }, { status: 202 });
  } catch (error) {
    return serviceErrorResponse(error, "Live API");
  }
}
