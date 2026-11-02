"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { SilenceDetectionConfig, DEFAULT_SILENCE_CONFIG, WakeWordRecordingConfig } from "@/lib/stt";

/** One recording. Near a cut, the next one already runs alongside it on the same mic. */
export interface Take {
  /** When it started and stopped recording, from Date.now() */
  startedAt: number;
  stoppedAt: number | null;
  /** When it first heard sound over the volume threshold, or null while it has heard none */
  voiceAt: number | null;
}

interface TakeState {
  take: Take;
  recorder: MediaRecorder;
  chunks: Blob[];
  /** When the current silence began, tracked once the recording is minRecordingDuration old */
  silenceStart: number | null;
  /** Stopped without sending what it recorded */
  dropped: boolean;
}

/** The open mic, which recordings share for as long as listening goes on */
interface Session {
  stream: MediaStream;
  audioContext: AudioContext;
  analyser: AnalyserNode;
  mimeType: string;
  /** Recording, oldest first. The oldest holds everything the others heard. */
  takes: TakeState[];
  /** Stopped, but their audio hasn't arrived yet */
  finishing: Set<TakeState>;
  ended: boolean;
}

interface UseAudioRecorderOptions {
  /** Called when audio recording is ready to be processed */
  onAudioReady: (audioBlob: Blob, take: Take) => void;
  /** Called with volume level (0-1) for visualization */
  onVolumeChange?: (volume: number) => void;
  /** Called when recording state changes */
  onRecordingStateChange?: (isRecording: boolean) => void;
  /** Custom silence detection settings */
  silenceConfig?: Partial<SilenceDetectionConfig>;
  /**
   * Cuts each recording this long after it first hears sound, with the next one starting
   * `overlap` earlier, so a phrase said at the cut is whole in the next one. Null records one
   * at a time, each up to maxRecordingDuration.
   */
  rolling?: WakeWordRecordingConfig | null;
}

interface UseAudioRecorderReturn {
  /** Whether currently recording */
  isRecording: boolean;
  /** Whether MediaRecorder is supported in this browser */
  isSupported: boolean;
  /** Whether audio activity has been detected (voice started) */
  hasAudioStarted: boolean;
  /** Current volume level (0-1) */
  currentVolume: number;
  /** Start recording */
  startRecording: () => Promise<void>;
  /** Stop recording manually */
  stopRecording: () => void;
  /** Stops these recordings without sending them, starting a new one if none is left */
  dropTakes: (shouldDrop: (take: Take) => boolean) => void;
}

function startTake(session: Session, onAudioReady: (audioBlob: Blob, take: Take) => void) {
  const recorder = new MediaRecorder(session.stream, { mimeType: session.mimeType });
  const state: TakeState = {
    take: { startedAt: Date.now(), stoppedAt: null, voiceAt: null },
    recorder,
    chunks: [],
    silenceStart: null,
    dropped: false,
  };

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      state.chunks.push(event.data);
    }
  };

  recorder.onstop = () => {
    // A recorder also stops on its own, if the mic goes away
    session.takes = session.takes.filter((other) => other !== state);
    state.take.stoppedAt ??= Date.now();
    session.finishing.delete(state);

    const audioBlob = new Blob(state.chunks, { type: session.mimeType });
    console.log(`[AudioRecorder] Recording stopped, blob size: ${audioBlob.size} bytes`);

    // Only process if we have meaningful audio
    if (state.dropped) {
      console.log("[AudioRecorder] Recording dropped");
    } else if (audioBlob.size > 1000 && state.take.voiceAt !== null) {
      onAudioReady(audioBlob, state.take);
    } else {
      console.log("[AudioRecorder] Recording too short or no voice detected, discarding");
    }

    releaseIfDone(session);
  };

  // Record in 100ms chunks
  recorder.start(100);
  session.takes.push(state);
}

function stopTake(session: Session, state: TakeState, dropped: boolean) {
  session.takes = session.takes.filter((other) => other !== state);
  state.dropped = dropped;
  state.take.stoppedAt = Date.now();
  if (state.recorder.state !== "inactive") {
    session.finishing.add(state);
    state.recorder.stop();
  }
}

/** Stops every recording, keeping only the oldest, which holds what the others heard */
function stopTakes(session: Session) {
  session.takes.forEach((state, index) => stopTake(session, state, index > 0));
}

/** Closes the mic once the session is over and every recording has its audio */
function releaseIfDone(session: Session) {
  if (!session.ended || session.takes.length > 0 || session.finishing.size > 0) {
    return;
  }
  session.stream.getTracks().forEach((track) => track.stop());
  if (session.audioContext.state !== "closed") {
    session.audioContext.close();
  }
}

/**
 * Hook for recording audio with automatic silence detection
 *
 * Features:
 * - MediaRecorder for audio capture
 * - Web Audio API for real-time volume analysis
 * - RMS-based silence detection
 * - Automatic stop when silence detected for configured duration
 * - Maximum recording duration limit, or overlapping recordings with `rolling`
 */
export function useAudioRecorder({
  onAudioReady,
  onVolumeChange,
  onRecordingStateChange,
  silenceConfig: customSilenceConfig,
  rolling = null,
}: UseAudioRecorderOptions): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [hasAudioStarted, setHasAudioStarted] = useState(false);
  const [currentVolume, setCurrentVolume] = useState(0);

  const sessionRef = useRef<Session | null>(null);
  const animationFrameRef = useRef<number>(0);
  const shouldStopRef = useRef(false);
  const hasAudioStartedRef = useRef(false);
  // True while waiting for the mic, before the session or isRecording can show it
  const isOpeningRef = useRef(false);

  // Callback refs to avoid stale closures
  const onAudioReadyRef = useRef(onAudioReady);
  const onVolumeChangeRef = useRef(onVolumeChange);
  const onRecordingStateChangeRef = useRef(onRecordingStateChange);
  // Read on every frame, so a change applies to the recording in progress
  const rollingRef = useRef(rolling);

  useEffect(() => {
    onAudioReadyRef.current = onAudioReady;
  }, [onAudioReady]);

  useEffect(() => {
    onVolumeChangeRef.current = onVolumeChange;
  }, [onVolumeChange]);

  useEffect(() => {
    onRecordingStateChangeRef.current = onRecordingStateChange;
  }, [onRecordingStateChange]);

  useEffect(() => {
    rollingRef.current = rolling;
  }, [rolling]);

  // Merge custom config with defaults (memoized to prevent unnecessary re-renders)
  const silenceConfig = useMemo<SilenceDetectionConfig>(
    () => ({
      ...DEFAULT_SILENCE_CONFIG,
      ...customSilenceConfig,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      customSilenceConfig?.silenceThreshold,
      customSilenceConfig?.volumeThreshold,
      customSilenceConfig?.minRecordingDuration,
      customSilenceConfig?.maxRecordingDuration,
    ]
  );

  // Check browser support on mount
  useEffect(() => {
    const supported =
      typeof window !== "undefined" &&
      "mediaDevices" in navigator &&
      "getUserMedia" in navigator.mediaDevices &&
      "MediaRecorder" in window;
    setIsSupported(supported);
  }, []);

  const handleAudio = useCallback((audioBlob: Blob, take: Take) => {
    onAudioReadyRef.current(audioBlob, take);
  }, []);

  /**
   * Calculate RMS (Root Mean Square) volume from audio data
   * RMS is a good measure of perceived loudness
   */
  const calculateRMS = useCallback((dataArray: Uint8Array): number => {
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      // Convert from 0-255 to -1 to 1
      const normalized = (dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / dataArray.length);
  }, []);

  /**
   * Stop recording and process collected audio
   */
  const stopRecording = useCallback(() => {
    shouldStopRef.current = true;
    cancelAnimationFrame(animationFrameRef.current);

    const session = sessionRef.current;
    if (session) {
      stopTakes(session);
      session.ended = true;
      sessionRef.current = null;
      releaseIfDone(session);
    }

    setIsRecording(false);
    setCurrentVolume(0);
    onRecordingStateChangeRef.current?.(false);
  }, []);

  /**
   * Monitor audio levels for silence detection
   * Uses requestAnimationFrame for smooth updates
   */
  const monitorAudio = useCallback(() => {
    const session = sessionRef.current;
    if (!session || shouldStopRef.current) {
      return;
    }

    const dataArray = new Uint8Array(session.analyser.frequencyBinCount);
    session.analyser.getByteTimeDomainData(dataArray);

    const rms = calculateRMS(dataArray);
    setCurrentVolume(rms);
    onVolumeChangeRef.current?.(rms);

    const now = Date.now();
    const rolling = rollingRef.current;

    // Recordings only overlap while they're being cut
    if (!rolling) {
      session.takes.slice(1).forEach((state) => stopTake(session, state, true));
    }

    for (const state of session.takes) {
      // Check for audio activity start (voice detected)
      if (state.take.voiceAt === null && rms > silenceConfig.volumeThreshold) {
        state.take.voiceAt = now;
        state.silenceStart = null;
        console.log("[AudioRecorder] Voice activity detected");
      }

      // Only track silence after the voice started and minRecordingDuration has passed
      if (state.take.voiceAt !== null && now - state.take.startedAt > silenceConfig.minRecordingDuration) {
        if (rms < silenceConfig.volumeThreshold) {
          state.silenceStart ??= now;
        } else {
          state.silenceStart = null;
        }
      }
    }

    const [oldest] = session.takes;
    if (!oldest) {
      // The mic went away
      stopRecording();
      return;
    }

    if (oldest.silenceStart !== null) {
      const silenceDuration = (now - oldest.silenceStart) / 1000;
      if (silenceDuration >= silenceConfig.silenceThreshold) {
        console.log(
          `[AudioRecorder] Silence detected for ${silenceDuration.toFixed(1)}s, stopping...`
        );
        stopRecording();
        return;
      }
    }

    if (rolling) {
      if (oldest.take.voiceAt !== null) {
        const heard = now - oldest.take.voiceAt;
        // Also at the cut itself, when the cap only came into force during this recording
        if (session.takes.length === 1 && heard >= rolling.maxRecordingDuration - rolling.overlap) {
          startTake(session, handleAudio);
        }
        if (heard >= rolling.maxRecordingDuration) {
          console.log("[AudioRecorder] Cap reached, the next recording goes on");
          stopTake(session, oldest, false);
        }
      } else if (now - oldest.take.startedAt >= silenceConfig.maxRecordingDuration) {
        // Swaps a recording that heard nothing for a new one, leaving no gap to miss a word in
        startTake(session, handleAudio);
        stopTake(session, oldest, true);
      }
    } else if (now - oldest.take.startedAt >= silenceConfig.maxRecordingDuration) {
      // Auto-stop at maximum recording duration
      console.log("[AudioRecorder] Max duration reached, stopping...");
      stopRecording();
      return;
    }

    const audioStarted = session.takes[0]?.take.voiceAt != null;
    if (audioStarted !== hasAudioStartedRef.current) {
      hasAudioStartedRef.current = audioStarted;
      setHasAudioStarted(audioStarted);
    }

    // Continue monitoring
    animationFrameRef.current = requestAnimationFrame(monitorAudio);
  }, [calculateRMS, silenceConfig, stopRecording, handleAudio]);

  /**
   * Start recording audio
   */
  const startRecording = useCallback(async () => {
    if (!isSupported) {
      return;
    }

    // Cleared before the check, so a start also undoes a stop that came while the mic was opening
    shouldStopRef.current = false;
    // Checks refs, not isRecording: that's only set once the mic is open, so a second start
    // would open another recorder that nothing can stop
    if (isOpeningRef.current || sessionRef.current) {
      return;
    }

    isOpeningRef.current = true;
    let stream: MediaStream | undefined;
    try {
      // Request microphone access with noise reduction
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (shouldStopRef.current) {
        console.log("[AudioRecorder] Stopped while the mic was opening");
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      // Set up AudioContext for volume analysis
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.3;
      audioContext.createMediaStreamSource(stream).connect(analyser);

      // Determine best supported MIME type
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";

      console.log(`[AudioRecorder] Using MIME type: ${mimeType}`);

      const session: Session = {
        stream,
        audioContext,
        analyser,
        mimeType,
        takes: [],
        finishing: new Set(),
        ended: false,
      };
      startTake(session, handleAudio);
      sessionRef.current = session;
      hasAudioStartedRef.current = false;
      setHasAudioStarted(false);
      setIsRecording(true);
      onRecordingStateChangeRef.current?.(true);

      console.log("[AudioRecorder] Started recording");

      // Start audio monitoring for silence detection
      animationFrameRef.current = requestAnimationFrame(monitorAudio);
    } catch (error) {
      console.error("[AudioRecorder] Failed to start recording:", error);
      stream?.getTracks().forEach((track) => track.stop());

      if (error instanceof Error) {
        if (error.name === "NotAllowedError") {
          console.error("[AudioRecorder] Microphone permission denied");
        } else if (error.name === "NotFoundError") {
          console.error("[AudioRecorder] No microphone found");
        }
      }
    } finally {
      isOpeningRef.current = false;
    }
  }, [isSupported, monitorAudio, handleAudio]);

  const dropTakes = useCallback(
    (shouldDrop: (take: Take) => boolean) => {
      const session = sessionRef.current;
      if (!session) {
        return;
      }

      const dropped = session.takes.filter((state) => shouldDrop(state.take));
      if (dropped.length === 0) {
        return;
      }

      // Keeps listening, without reopening the mic
      if (dropped.length === session.takes.length) {
        startTake(session, handleAudio);
      }
      dropped.forEach((state) => stopTake(session, state, true));
    },
    [handleAudio]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldStopRef.current = true;
      cancelAnimationFrame(animationFrameRef.current);

      const session = sessionRef.current;
      if (session) {
        session.takes.forEach((state) => stopTake(session, state, true));
        session.ended = true;
        sessionRef.current = null;
        releaseIfDone(session);
      }
    };
  }, []);

  return {
    isRecording,
    isSupported,
    hasAudioStarted,
    currentVolume,
    startRecording,
    stopRecording,
    dropTakes,
  };
}
