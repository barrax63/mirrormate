import { NextRequest, NextResponse } from "next/server";
import { getSTTProvider } from "@/lib/providers/stt";
import { getCharacterNames } from "@/lib/character";
import { serviceErrorResponse } from "@/lib/errors/classify";

/**
 * POST /api/stt
 * Transcribe audio using configured STT provider (OpenAI Whisper or Local Whisper)
 *
 * Request: multipart/form-data
 * - audio: Blob (required) - Audio file (webm, mp3, wav, etc.)
 * - purpose: "wakeWord" | "speech" (required) - wakeWord for anything heard while waiting for
 *   the wake word, which only local Whisper transcribes, and speech for what's said after it
 * - language: string (optional) - Language code (e.g., "ja", "en")
 *
 * Response:
 * - transcript: string - Transcribed text
 * - language: string (optional) - Detected language
 * - duration: number (optional) - Audio duration in seconds
 *
 * On failure: error, and code and service saying why (see src/lib/errors/service-error.ts)
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    const language = formData.get("language") as string | null;
    const purpose = formData.get("purpose");

    if (purpose !== "wakeWord" && purpose !== "speech") {
      return NextResponse.json(
        { error: "Send the purpose of the recording as 'purpose': 'wakeWord' or 'speech'." },
        { status: 400 }
      );
    }

    const provider = getSTTProvider(purpose);

    if (!provider) {
      const error =
        purpose === "wakeWord"
          ? "No wake word provider. Set stt.wakeWord.provider to 'local' in providers.yaml: wake word audio never goes to a cloud service."
          : "No STT provider. Set stt.enabled to true, and stt.provider to 'openai' or 'local', in providers.yaml.";
      // The page tells the user to look here
      console.error(`[STT API] ${error}`);
      return NextResponse.json({ error, code: "failed" }, { status: 400 });
    }

    if (!audioFile) {
      return NextResponse.json(
        { error: "Audio file is required. Send as 'audio' field in FormData." },
        { status: 400 }
      );
    }

    // Validate file size (max 25MB for Whisper API)
    const maxSize = 25 * 1024 * 1024; // 25MB
    if (audioFile.size > maxSize) {
      return NextResponse.json(
        { error: `Audio file too large. Maximum size is 25MB.` },
        { status: 400 }
      );
    }

    // Validate file type
    const supportedFormats = provider.getSupportedFormats();
    const fileExtension = audioFile.name.split(".").pop()?.toLowerCase();
    const mimeType = audioFile.type.split("/")[1]?.split(";")[0];

    const isSupported =
      (fileExtension && supportedFormats.includes(fileExtension)) ||
      (mimeType && supportedFormats.includes(mimeType));

    if (!isSupported) {
      console.log(
        `[STT API] File type check - extension: ${fileExtension}, mime: ${mimeType}`
      );
      // Allow webm even if not explicitly matched
      if (!audioFile.type.includes("webm") && !audioFile.type.includes("audio")) {
        return NextResponse.json(
          {
            error: `Unsupported audio format. Supported: ${supportedFormats.join(", ")}`,
          },
          { status: 400 }
        );
      }
    }

    console.log(
      `[STT API] Transcribing: ${audioFile.size} bytes, type: ${audioFile.type}, purpose: ${purpose}, provider: ${provider.getProviderName()}`
    );

    // Convert File to Buffer
    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    // Transcribe. Without the names, gpt-transcribe wrote Mira as Myra or Mia.
    const result = await provider.transcribe(audioBuffer, {
      language: language || undefined,
      keywords: getCharacterNames(),
    });

    console.log(`[STT API] Success: ${result.transcript.length} characters`);

    return NextResponse.json({
      transcript: result.transcript,
      language: result.language,
      duration: result.duration,
    });
  } catch (error) {
    return serviceErrorResponse(error, "STT API");
  }
}
