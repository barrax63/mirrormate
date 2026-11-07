import {
  STTProvider,
  TranscribeOptions,
  TranscribeResult,
  LocalWhisperConfig,
} from "./types";
import { ServiceError } from "../errors/service-error";

/**
 * Local Whisper STT Provider
 * Compatible with faster-whisper, whisper.cpp, and other self-hosted Whisper servers
 *
 * Expected API format (compatible with faster-whisper-server):
 * POST /v1/audio/transcriptions
 * Content-Type: multipart/form-data
 * - file: audio file
 * - model: model name (optional)
 * - language: language code (optional)
 *
 * Response:
 * { "text": "transcribed text" }
 */
export class LocalWhisperProvider implements STTProvider {
  private config: LocalWhisperConfig;
  private baseUrl: string;

  constructor(config: LocalWhisperConfig = {}) {
    this.config = config;
    this.baseUrl = config.baseUrl || "http://localhost:8080";

    // Remove trailing slash if present
    if (this.baseUrl.endsWith("/")) {
      this.baseUrl = this.baseUrl.slice(0, -1);
    }
  }

  getProviderName(): string {
    return "local-whisper";
  }

  getSupportedFormats(): string[] {
    return ["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm", "ogg"];
  }

  /**
   * Whether speaches' VAD finds no speech in the audio, with the settings it transcribes with
   * (DEFAULT_VAD_OPTIONS in its routers/stt.py). speaches 0.9.0-rc.3 answers a recording of 30 s
   * or more without speech with a 500, where it should return no text, and only this tells that
   * apart from a real failure. A server without this route counts as having found speech.
   */
  private async hearsNoSpeech(audio: Blob): Promise<boolean> {
    const formData = new FormData();
    formData.append("file", audio, "audio.webm");
    formData.append("threshold", "0.5");
    formData.append("min_silence_duration_ms", "160");
    formData.append("max_speech_duration_s", "30");
    formData.append("speech_pad_ms", "400");
    try {
      const response = await fetch(`${this.baseUrl}/v1/audio/speech/timestamps`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        return false;
      }
      const segments: unknown = await response.json();
      return Array.isArray(segments) && segments.length === 0;
    } catch {
      return false;
    }
  }

  async transcribe(
    audio: Buffer,
    options?: TranscribeOptions
  ): Promise<TranscribeResult> {
    const language = options?.language || this.config.language;
    const model = this.config.model || "base";

    console.log(
      `[LocalWhisperProvider] Transcribing audio: ${audio.length} bytes, model: ${model}, language: ${language || "auto"}`
    );

    // Create FormData with audio file
    const formData = new FormData();
    // Convert Buffer to Uint8Array for Blob compatibility
    const uint8Array = new Uint8Array(audio);
    const blob = new Blob([uint8Array], { type: "audio/webm" });
    formData.append("file", blob, "audio.webm");

    if (model) {
      formData.append("model", model);
    }

    if (language) {
      formData.append("language", language);
    }

    // Try OpenAI-compatible endpoint first (faster-whisper-server format)
    const endpoint = `${this.baseUrl}/v1/audio/transcriptions`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 500 && (await this.hearsNoSpeech(blob))) {
          console.log("[LocalWhisperProvider] No speech in the recording");
          return { transcript: "" };
        }
        throw new ServiceError(
          response.status >= 502 && response.status <= 504 ? "unavailable" : "failed",
          "localWhisper",
          `Local Whisper API error: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();

      // Handle different response formats
      const transcript = data.text || data.transcript || "";

      console.log(`[LocalWhisperProvider] Transcription complete: ${transcript.length} characters`);

      return {
        transcript,
        language: data.language,
        duration: data.duration,
      };
    } catch (error) {
      // If OpenAI-compatible endpoint fails, try alternative endpoint
      console.log(
        "[LocalWhisperProvider] Trying alternative endpoint /transcribe"
      );

      try {
        const altEndpoint = `${this.baseUrl}/transcribe`;
        const altResponse = await fetch(altEndpoint, {
          method: "POST",
          body: formData,
        });

        if (!altResponse.ok) {
          throw error; // Re-throw original error
        }

        const altData = await altResponse.json();
        const transcript = altData.text || altData.transcript || "";

        return {
          transcript,
          language: altData.language,
          duration: altData.duration,
        };
      } catch {
        // Re-throw original error with more context. One that isn't an error status means the
        // server couldn't be reached.
        if (error instanceof ServiceError) {
          throw new ServiceError(
            error.code,
            "localWhisper",
            `[LocalWhisperProvider] Local Whisper server at ${this.baseUrl} failed: ${error.message}`
          );
        }
        throw new ServiceError(
          "unavailable",
          "localWhisper",
          `[LocalWhisperProvider] Failed to connect to local Whisper server at ${this.baseUrl}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }
  }
}
