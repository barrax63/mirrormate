"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { useAudioRecorder, type Take } from "./useAudioRecorder";
import { STTClientConfig, STTPurpose, SilenceDetectionConfig } from "@/lib/stt";
import { routeErrorFrom, type ServiceErrorReporter } from "@/lib/errors/service-errors";

interface UseSpeechRecognitionOptions {
  /** Called when a final transcript is received */
  onResult: (transcript: string) => void;
  /** Called with "..." while recording or transcribing, and "" once a transcript is in */
  onInterimResult?: (transcript: string) => void;
  /** Called when recording state changes */
  onRecordingStateChange?: (isRecording: boolean) => void;
  /** Called with volume level for visualization */
  onVolumeChange?: (volume: number) => void;
  /**
   * True while waiting for the wake word. Recordings made at any point while it's true
   * go to local Whisper only, and are cut short so a long talk can't delay the wake word.
   */
  listeningForWakeWord: boolean;
  /** Told how the config and each transcription request went, and asked first whether to wait */
  serviceErrors?: ServiceErrorReporter;
}

interface UseSpeechRecognitionReturn {
  /** Whether currently recording */
  isListening: boolean;
  /** Whether the browser can record audio */
  isSupported: boolean;
  /** Whether Whisper is currently transcribing audio */
  isTranscribing: boolean;
  /** Current volume level (0-1) */
  currentVolume: number;
  /** Start listening */
  start: () => void;
  /** Stop listening completely */
  stop: () => void;
  /** Pause listening temporarily */
  pause: () => void;
  /** Resume listening after pause */
  resume: () => void;
}

/**
 * Speech recognition with Whisper (OpenAI or local), through /api/stt
 *
 * Features:
 * - Automatic silence detection for natural conversation flow
 * - Records nothing until the STT config has loaded, since it says how to cut recordings
 */
export function useSpeechRecognition({
  onResult,
  onInterimResult,
  onRecordingStateChange,
  onVolumeChange,
  listeningForWakeWord,
  serviceErrors,
}: UseSpeechRecognitionOptions): UseSpeechRecognitionReturn {
  // State
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [sttConfig, setSTTConfig] = useState<STTClientConfig | null>(null);
  const [currentVolume, setCurrentVolume] = useState(0);

  // Wake word refs, all times from Date.now()
  const listeningForWakeWordRef = useRef(listeningForWakeWord);
  // When the conversation started, or null while waiting for the wake word
  const conversationSinceRef = useRef<number | null>(null);
  // The last recording whose transcript arrived while waiting, which the wake word came from
  const lastWaitingTakeRef = useRef<Take | null>(null);
  // When the recording with the wake word stopped. Recordings that started earlier hold what
  // the room said before it.
  const wakeWordEndRef = useRef(0);
  const transcriptionsRef = useRef(0);

  // Callback refs to avoid stale closures
  const onResultRef = useRef(onResult);
  const onInterimResultRef = useRef(onInterimResult);
  const serviceErrorsRef = useRef(serviceErrors);

  useEffect(() => {
    serviceErrorsRef.current = serviceErrors;
  }, [serviceErrors]);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    onInterimResultRef.current = onInterimResult;
  }, [onInterimResult]);

  // Fetch STT configuration from server. Without it nothing is recorded, and the pages say why.
  useEffect(() => {
    async function fetchSTTConfig() {
      try {
        const res = await fetch("/api/stt/config");
        if (!res.ok) {
          const error = await routeErrorFrom(res);
          console.error("[SpeechRecognition] STT config request failed:", res.status, error);
          serviceErrorsRef.current?.failed("speech", error);
          return;
        }
        const config: STTClientConfig = await res.json();
        setSTTConfig(config);
      } catch (error) {
        console.error("[SpeechRecognition] STT config request failed:", error);
        // The app's own server didn't answer
        serviceErrorsRef.current?.failed("speech", { code: "unavailable" });
      }
    }
    fetchSTTConfig();
  }, []);

  /**
   * Handle Whisper transcription
   * Called when audio recording is complete
   */
  const handleWhisperTranscription = useCallback(
    async (audioBlob: Blob, take: Take) => {
      // Wake word audio if it was waiting at any point during the recording
      const conversationSince = conversationSinceRef.current;
      const purpose: STTPurpose =
        listeningForWakeWordRef.current ||
        conversationSince === null ||
        take.startedAt < conversationSince
          ? "wakeWord"
          : "speech";

      const serviceErrors = serviceErrorsRef.current;
      if (serviceErrors?.isBackingOff(purpose)) {
        console.log(`[SpeechRecognition] Not sending audio: ${purpose} failed, waiting before trying again`);
        return;
      }

      // Recordings overlap while waiting, so several can be transcribed at once
      transcriptionsRef.current++;
      setIsTranscribing(true);
      onInterimResultRef.current?.("...");

      try {
        const formData = new FormData();
        formData.append("audio", audioBlob, "audio.webm");
        formData.append("purpose", purpose);
        // Whisper takes ISO 639-1 codes, so a language set as en-US is sent as en
        const whisperLang = (sttConfig?.language || "en").split("-")[0];
        formData.append("language", whisperLang);

        console.log(
          `[SpeechRecognition] Sending audio to Whisper: ${audioBlob.size} bytes, purpose: ${purpose}`
        );

        const response = await fetch("/api/stt", {
          method: "POST",
          body: formData,
        });

        if (response.ok) {
          serviceErrors?.succeeded(purpose);
          const data = await response.json();
          if (data.transcript && data.transcript.trim()) {
            console.log(
              `[SpeechRecognition] Whisper result: "${data.transcript}"`
            );
            onInterimResultRef.current?.("");
            if (listeningForWakeWordRef.current) {
              lastWaitingTakeRef.current = take;
            } else if (take.startedAt < wakeWordEndRef.current) {
              // Also heard the room before the wake word, or is the overlap of the one it was in
              console.log("[SpeechRecognition] Ignoring a recording from before the wake word");
              return;
            }
            onResultRef.current(data.transcript);
          } else {
            console.log("[SpeechRecognition] Whisper returned empty transcript");
            onInterimResultRef.current?.("");
          }
        } else {
          const error = await routeErrorFrom(response);
          console.error("[SpeechRecognition] Whisper API error:", response.status, error);
          serviceErrors?.failed(purpose, error);
          onInterimResultRef.current?.("");
        }
      } catch (error) {
        console.error("[SpeechRecognition] Whisper transcription error:", error);
        // The app's own server didn't answer
        serviceErrors?.failed(purpose, { code: "unavailable" });
        onInterimResultRef.current?.("");
      } finally {
        transcriptionsRef.current--;
        if (transcriptionsRef.current === 0) {
          setIsTranscribing(false);
        }
      }
    },
    [sttConfig?.language]
  );

  /**
   * Handle volume changes from audio recorder
   */
  const handleVolumeChange = useCallback(
    (volume: number) => {
      setCurrentVolume(volume);
      onVolumeChange?.(volume);
    },
    [onVolumeChange]
  );

  /**
   * Handle recording state changes
   */
  const handleRecordingStateChange = useCallback(
    (recording: boolean) => {
      setIsListening(recording);
      onRecordingStateChange?.(recording);
    },
    [onRecordingStateChange]
  );

  const {
    isRecording,
    isSupported,
    hasAudioStarted,
    startRecording,
    stopRecording,
    dropTakes,
  } = useAudioRecorder({
    onAudioReady: handleWhisperTranscription,
    onVolumeChange: handleVolumeChange,
    onRecordingStateChange: handleRecordingStateChange,
    silenceConfig: sttConfig?.silenceDetection as
      | Partial<SilenceDetectionConfig>
      | undefined,
    rolling: listeningForWakeWord ? (sttConfig?.wakeWord ?? null) : null,
  });

  // A layout effect, so recordings see a change of mode as soon as possible
  useLayoutEffect(() => {
    listeningForWakeWordRef.current = listeningForWakeWord;
    if (listeningForWakeWord) {
      conversationSinceRef.current = null;
      lastWaitingTakeRef.current = null;
      return;
    }

    const now = Date.now();
    const wakeWordEnd = lastWaitingTakeRef.current?.stoppedAt ?? now;
    conversationSinceRef.current = now;
    wakeWordEndRef.current = wakeWordEnd;
    // Recordings from before the wake word ended hold what the room said before it, and ones
    // that haven't heard anything yet would still go to local Whisper. A new one replaces them.
    dropTakes((take) => take.startedAt < wakeWordEnd || take.voiceAt === null);
  }, [listeningForWakeWord, dropTakes]);

  // Show interim feedback while recording
  useEffect(() => {
    if (isRecording && hasAudioStarted) {
      onInterimResultRef.current?.("...");
    } else if (isRecording && !hasAudioStarted) {
      onInterimResultRef.current?.("...");
    } else if (!isRecording && !isTranscribing) {
      // Clear interim when not recording and not transcribing
    }
  }, [isRecording, hasAudioStarted, isTranscribing]);

  // Starting and resuming are the same, as are stopping and pausing. Also starts while the last
  // recording is transcribed, or what's said meanwhile is lost.
  const listen = useCallback(() => {
    if (sttConfig && !isRecording) {
      startRecording();
    }
  }, [sttConfig, isRecording, startRecording]);

  return {
    isListening,
    isSupported,
    isTranscribing,
    currentVolume,
    start: listen,
    stop: stopRecording,
    pause: stopRecording,
    resume: listen,
  };
}
