"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import SimpleAvatar from "@/components/SimpleAvatar";
import Confetti, { EffectType } from "@/components/Confetti";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useWakeWord } from "@/hooks/useWakeWord";
import { useReminder, Reminder } from "@/hooks/useReminder";
import { useAvatarState } from "@/hooks/useAvatarState";
import { useAnimationController } from "@/hooks/useAnimationController";
import { useLongThinkingPulse } from "@/hooks/useLongThinkingPulse";
import { useVisionEnabled } from "@/hooks/useVisionEnabled";
import { useServiceErrors } from "@/hooks/useServiceErrors";
import { ServiceErrorList } from "@/components/ServiceErrorList";
import { routeErrorFrom } from "@/lib/errors/service-errors";
import { DEFAULT_HISTORY_LIMIT, historyLimitFrom, trimHistory } from "@/lib/chat/history";
import { FloatingInfo, InfoCard, detectInfoFromResponse } from "@/components/FloatingInfo";
import PluginRenderer from "@/components/PluginRenderer";
import { mapBroadcastToEvent, type BroadcastMessage } from "@/lib/animation/broadcast-adapter";

export default function AvatarPage() {
  const t = useTranslations("mic");
  const tReminder = useTranslations("reminder");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [mouthOpenness, setMouthOpenness] = useState(0);
  const [userText, setUserText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [displayText, setDisplayText] = useState("");
  const [isTextFading, setIsTextFading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [infoCards, setInfoCards] = useState<InfoCard[]>([]);
  const [showEffect, setShowEffect] = useState(false);
  const [effectType, setEffectType] = useState<EffectType>("confetti");
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [currentVoice, setCurrentVoice] = useState<string | null>(null);
  const [currentCharacter, setCurrentCharacter] = useState<string | null>(null);
  const [showMicOffNotice, setShowMicOffNotice] = useState(false);
  const [isFirstRun, setIsFirstRun] = useState(false);
  const prevSpeechEnabledRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const textFadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number>(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const messagesRef = useRef<Array<{ role: string; content: string }>>([]);
  // The server's limit on history, from its last reply
  const historyLimitRef = useRef(DEFAULT_HISTORY_LIMIT);
  const pendingCaptureRef = useRef<{
    resolve: (image: string | null) => void;
    timeout: NodeJS.Timeout;
  } | null>(null);

  // Failed requests, shown on the page and /control, and when to try again
  const { errors: serviceErrorList, reporter: serviceErrors } = useServiceErrors();

  // Read through a ref, so the capture below always sees the current setting
  const { visionEnabled } = useVisionEnabled();
  const visionEnabledRef = useRef(visionEnabled);
  useEffect(() => {
    visionEnabledRef.current = visionEnabled;
  }, [visionEnabled]);

  // Request camera capture from vision companion plugin
  const requestCameraCapture = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      // No frame while Vision is off, or before the setting has loaded
      if (!channelRef.current || visionEnabledRef.current !== true) {
        resolve(null);
        return;
      }

      // Set up timeout for capture response
      const timeout = setTimeout(() => {
        console.warn("[Avatar] Camera capture timeout");
        if (pendingCaptureRef.current) {
          pendingCaptureRef.current = null;
          resolve(null);
        }
      }, 2000);

      pendingCaptureRef.current = { resolve, timeout };

      // Request capture
      channelRef.current.postMessage({ type: "camera_capture_request" });
    });
  }, []);

  // Load saved settings on mount (from DB with localStorage fallback)
  useEffect(() => {
    async function loadSettings() {
      try {
        const response = await fetch("/api/settings");
        if (response.ok) {
          const data = await response.json();
          if (data.voice) {
            setCurrentVoice(data.voice);
          }
          if (data.characterId) {
            setCurrentCharacter(data.characterId);
          }
          return;
        }
      } catch {
        // Fall back to localStorage
      }

      // Fallback to localStorage
      const savedVoice = localStorage.getItem("mirrormate:voice");
      const savedCharacter = localStorage.getItem("mirrormate:character");
      if (savedVoice) {
        setCurrentVoice(savedVoice);
      }
      if (savedCharacter) {
        setCurrentCharacter(savedCharacter);
      }
    }

    loadSettings();
  }, []);

  // Animation state machine
  const { state: avatarState, context: stateContext, dispatch: dispatchState } = useAvatarState();

  // Wake word hook
  const {
    mode: wakeWordMode,
    config: wakeWordConfig,
    isEnabled: isWakeWordEnabled,
    checkForWakeWord,
    resetTimeout: resetWakeWordTimeout,
    endConversation,
  } = useWakeWord();

  // Override avatar state to SLEEP when waiting for wake word
  const effectiveAvatarState = useMemo(() => {
    if (isWakeWordEnabled && wakeWordMode === "waiting" && !isSpeaking && !isThinking) {
      return "SLEEP" as const;
    }
    return avatarState;
  }, [isWakeWordEnabled, wakeWordMode, isSpeaking, isThinking, avatarState]);

  const animationParams = useAnimationController(effectiveAvatarState, stateContext, { mousePosition });
  const { showPulse: showLongThinkingPulse } = useLongThinkingPulse(effectiveAvatarState, stateContext);

  // Track mouse position for gaze
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: -(e.clientY / window.innerHeight) * 2 + 1,
      });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Sync state machine with boolean states
  useEffect(() => {
    if (speechEnabled) {
      dispatchState({ type: "MIC_ACTIVATED" });
    } else {
      dispatchState({ type: "MIC_DEACTIVATED" });
    }
  }, [speechEnabled, dispatchState]);

  // Show MIC OFF notice when mic is disabled
  useEffect(() => {
    if (prevSpeechEnabledRef.current && !speechEnabled) {
      setShowMicOffNotice(true);
      const timer = setTimeout(() => setShowMicOffNotice(false), 1500);
      return () => clearTimeout(timer);
    }
    prevSpeechEnabledRef.current = speechEnabled;
  }, [speechEnabled]);

  // Check for first run
  useEffect(() => {
    const hasRun = localStorage.getItem("mirrormate:hasRun");
    if (!hasRun) {
      setIsFirstRun(true);
      localStorage.setItem("mirrormate:hasRun", "true");
      const timer = setTimeout(() => setIsFirstRun(false), 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (isThinking) {
      dispatchState({ type: "PROCESSING_START" });
    } else {
      dispatchState({ type: "PROCESSING_END" });
    }
  }, [isThinking, dispatchState]);

  useEffect(() => {
    if (isSpeaking) {
      dispatchState({ type: "TTS_START" });
    } else {
      dispatchState({ type: "TTS_END" });
    }
  }, [isSpeaking, dispatchState]);

  // Add InfoCard
  const addInfoCard = useCallback((response: string) => {
    const card = detectInfoFromResponse(response);
    if (card) {
      setInfoCards((prev) => [...prev, card]);
    }
  }, []);

  // Dismiss InfoCard
  const dismissInfoCard = useCallback((id: string) => {
    setInfoCards((prev) => prev.filter((card) => card.id !== id));
  }, []);

  // Auto fade-out text with duration based on text length
  // Formula: 1-120 chars = 10-14s, then +2s per 40 chars, max 24s
  useEffect(() => {
    if (displayText && !isThinking) {
      // Clear existing timer
      if (textFadeTimeoutRef.current) {
        clearTimeout(textFadeTimeoutRef.current);
      }
      setIsTextFading(false);

      // Calculate display duration based on text length
      const charCount = displayText.length;
      let displayDuration: number;
      if (charCount <= 120) {
        // 10-14s for 1-120 chars
        displayDuration = 10000 + (charCount / 120) * 4000;
      } else {
        // +2s per 40 chars beyond 120, max 24s
        const extraChars = charCount - 120;
        const extraTime = Math.floor(extraChars / 40) * 2000;
        displayDuration = Math.min(14000 + extraTime, 24000);
      }

      textFadeTimeoutRef.current = setTimeout(() => {
        setIsTextFading(true);
        setTimeout(() => {
          setDisplayText("");
          setUserText("");
          setIsTextFading(false);
        }, 2000); // Fade animation duration
      }, displayDuration);
    }

    return () => {
      if (textFadeTimeoutRef.current) {
        clearTimeout(textFadeTimeoutRef.current);
      }
    };
  }, [displayText, isThinking]);

  // Analyze audio amplitude in real-time
  const analyzeAudio = useCallback(() => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    let sum = 0;
    const voiceRange = Math.floor(dataArray.length * 0.3);
    for (let i = 0; i < voiceRange; i++) {
      sum += dataArray[i];
    }
    const average = sum / voiceRange;
    // ElevenLabs voices fill these bins about twice as strongly as the old OpenAI voice did, so
    // the old formula, average / 128 * 1.5, held the mouth fully open 3 frames in 4. Shut below
    // 60 and fully open from 140, it moves about as it did with that voice.
    const normalized = Math.min(1, Math.max(0, (average - 60) / 80));
    setMouthOpenness(normalized);

    animationRef.current = requestAnimationFrame(analyzeAudio);
  }, []);

  const playAudio = useCallback(async (audioBase64: string) => {
    return new Promise<void>(async (resolve) => {
      // The AudioContext outlives this reply, so its nodes must be disconnected afterwards
      let releaseNodes = () => {};

      try {
        console.log("[Avatar] playAudio: starting...");

        // Reuse existing AudioContext for background playback
        if (!audioContextRef.current || audioContextRef.current.state === "closed") {
          audioContextRef.current = new AudioContext();
          console.log("[Avatar] Created new AudioContext");
        }

        const audioContext = audioContextRef.current;
        console.log("[Avatar] AudioContext state:", audioContext.state);

        if (audioContext.state === "suspended") {
          console.log("[Avatar] Resuming suspended AudioContext...");
          await audioContext.resume();
          console.log("[Avatar] AudioContext resumed, state:", audioContext.state);
        }

        const audio = new Audio(`data:audio/mp3;base64,${audioBase64}`);
        audioRef.current = audio;

        // Wait for audio to load
        await new Promise<void>((res) => {
          audio.oncanplaythrough = () => {
            console.log("[Avatar] Audio loaded and ready");
            res();
          };
          audio.onerror = (e) => {
            console.error("[Avatar] Audio load error:", e);
            res();
          };
        });

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        analyserRef.current = analyser;

        const source = audioContext.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        releaseNodes = () => {
          source.disconnect();
          analyser.disconnect();
        };

        audio.onplay = () => {
          console.log("[Avatar] Audio playback started");
          setIsSpeaking(true);
          analyzeAudio();
        };
        audio.onended = () => {
          console.log("[Avatar] Audio playback ended");
          releaseNodes();
          setIsSpeaking(false);
          setMouthOpenness(0);
          cancelAnimationFrame(animationRef.current);
          // Keep AudioContext open for reuse
          resolve();
        };
        audio.onerror = (e) => {
          console.error("[Avatar] Audio playback error:", e);
          releaseNodes();
          setIsSpeaking(false);
          setMouthOpenness(0);
          cancelAnimationFrame(animationRef.current);
          resolve();
        };

        console.log("[Avatar] Calling audio.play()...");
        await audio.play();
        console.log("[Avatar] audio.play() returned");
      } catch (e) {
        console.error("[Avatar] playAudio error:", e);
        releaseNodes();
        setIsSpeaking(false);
        setMouthOpenness(0);
        resolve();
      }
    });
  }, [analyzeAudio]);

  // Asks /api/tts for speech and plays it. Reports how it went, and waits after a rejected key,
  // no credit or a rate limit. Returns whether there was audio to play.
  const speak = useCallback(
    async (text: string, voice: string | undefined): Promise<boolean> => {
      if (serviceErrors.isBackingOff("tts")) {
        console.log("[Avatar] Not asking for speech: it failed, waiting before trying again");
        return false;
      }

      let audio: string | null;
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice }),
        });
        if (!res.ok) {
          const error = await routeErrorFrom(res);
          console.error("[Avatar] TTS API failed:", res.status, error);
          serviceErrors.failed("tts", error);
          return false;
        }
        serviceErrors.succeeded("tts");
        ({ audio } = await res.json());
      } catch (e) {
        console.error("[Avatar] TTS error:", e);
        // The app's own server didn't answer
        serviceErrors.failed("tts", { code: "unavailable" });
        return false;
      }

      if (!audio) {
        console.warn("[Avatar] TTS returned no audio data");
        return false;
      }
      await playAudio(audio);
      return true;
    },
    [serviceErrors, playAudio]
  );

  // Handle reminder notifications
  const handleReminder = useCallback(
    async (reminder: Reminder) => {
      const timeText = tReminder("timeText", { minutes: reminder.configuredMinutes });

      // Add reminder card
      const card: InfoCard = {
        id: reminder.id,
        type: "reminder",
        title: tReminder("title", { timeText }),
        items: [reminder.summary],
        urgent: reminder.urgent,
      };
      setInfoCards((prev) => [...prev, card]);

      // Notify via TTS if not currently speaking
      if (!isSpeaking && !isProcessing) {
        const message = tReminder("message", { timeText, summary: reminder.summary });
        setDisplayText(message);
        await speak(message, currentVoice ?? undefined);
      }
    },
    [isSpeaking, isProcessing, speak, currentVoice, tReminder]
  );

  // Reminder hook (config loaded from YAML)
  useReminder({
    onReminder: handleReminder,
  });

  // Process speech recognition results
  const handleSpeechResult = useCallback(
    async (transcript: string) => {
      if (isProcessing || isSpeaking) return;

      // Until the wake word config has loaded, everything heard counts as wake word audio
      if (!wakeWordConfig) return;

      // Wake word mode handling
      if (isWakeWordEnabled) {
        if (wakeWordMode === "waiting") {
          // Check for wake word
          const wakeWordDetected = checkForWakeWord(transcript);
          if (!wakeWordDetected) {
            // No wake word detected, ignore
            return;
          }
          // Wake word detected - just wake up and wait for next message
          // Don't process any message in the same utterance
          return;
        } else {
          // In conversation mode, reset timeout
          resetWakeWordTimeout();
        }
      }

      if (serviceErrors.isBackingOff("chat")) {
        console.log("[Avatar] Not asking for a reply: it failed, waiting before trying again");
        return;
      }

      setIsProcessing(true);
      setUserText(transcript);
      setInterimText("");
      setDisplayText("");
      setIsThinking(true);

      // Add to message history, keeping only what the server will use, so it stops growing
      messagesRef.current.push({ role: "user", content: transcript });
      messagesRef.current = trimHistory(messagesRef.current, historyLimitRef.current);

      try {
        // Capture a camera frame while Vision is on (LLM will decide if it needs to use see_camera tool)
        const capturedImage = await requestCameraCapture();
        if (capturedImage) {
          console.log("[Avatar] Camera image captured:", capturedImage.length, "chars");
        }

        // Call chat API
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: messagesRef.current,
            characterId: currentCharacter ?? undefined,
            image: capturedImage ?? undefined,
          }),
        });

        if (res.ok) {
          serviceErrors.succeeded("chat");
          const data = await res.json();
          setIsThinking(false);
          setDisplayText(data.message);

          // Add to message history
          historyLimitRef.current = historyLimitFrom(data.historyLimit);
          messagesRef.current.push({ role: "assistant", content: data.message });
          messagesRef.current = trimHistory(messagesRef.current, historyLimitRef.current);

          // Show info cards from tools
          if (data.infoCards && data.infoCards.length > 0) {
            const newCards: InfoCard[] = data.infoCards.map((card: { type: InfoCard["type"]; title: string; items: string[] }) => ({
              id: crypto.randomUUID(),
              type: card.type,
              title: card.title,
              items: card.items,
            }));
            setInfoCards((prev) => [...prev, ...newCards]);
          }

          // Show effect
          if (data.effect === "confetti" || data.effect === "hearts" || data.effect === "sparkles") {
            setEffectType(data.effect as EffectType);
            setShowEffect(true);
          }

          // Play TTS
          if (data.message) {
            await speak(data.message, currentVoice ?? undefined);
          }
        } else {
          const error = await routeErrorFrom(res);
          console.error("Chat error:", res.status, error);
          serviceErrors.failed("chat", error);
          setIsThinking(false);
        }
      } catch (e) {
        console.error("Chat error:", e);
        // The app's own server didn't answer
        serviceErrors.failed("chat", { code: "unavailable" });
        setIsThinking(false);
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, isSpeaking, speak, serviceErrors, wakeWordConfig, isWakeWordEnabled, wakeWordMode, checkForWakeWord, resetWakeWordTimeout, currentVoice, currentCharacter, requestCameraCapture]
  );

  // Speech recognition hook. Until the wake word config has loaded, it listens as if waiting.
  const { isListening, isSupported, start, stop, pause, resume } = useSpeechRecognition({
    onResult: handleSpeechResult,
    onInterimResult: setInterimText,
    listeningForWakeWord: !wakeWordConfig || (isWakeWordEnabled && wakeWordMode === "waiting"),
    serviceErrors,
  });

  // Pause speech recognition while speaking
  useEffect(() => {
    if (isSpeaking || isProcessing) {
      pause();
    } else if (speechEnabled) {
      resume();
    }
  }, [isSpeaking, isProcessing, speechEnabled, pause, resume]);

  // Broadcast mic status
  const broadcastMicStatus = useCallback((enabled: boolean, listening: boolean) => {
    const status = !enabled ? "off" : listening ? "listening" : "paused";
    try {
      channelRef.current?.postMessage({ type: "mic_status", payload: status });
    } catch {
      // Channel is closed - ignore
    }
  }, []);

  // Notify control panel of mic status
  useEffect(() => {
    broadcastMicStatus(speechEnabled, isListening);
  }, [speechEnabled, isListening, broadcastMicStatus]);

  // Initialize AudioContext on click (required for TTS playback)
  const initAudioContext = useCallback(async () => {
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
  }, []);

  // Handle messages from BroadcastChannel
  const handleChannelMessage = useCallback(
    async (event: MessageEvent<BroadcastMessage>) => {
      const { type, payload } = event.data;

      switch (type) {
        case "user_message":
          setUserText(payload || "");
          setDisplayText("");
          break;
        case "thinking_start":
          setIsThinking(true);
          break;
        case "thinking_end":
          setIsThinking(false);
          break;
        case "response":
          setDisplayText(payload || "");
          // Detect weather/calendar info and show card
          if (payload) {
            const card = detectInfoFromResponse(payload);
            if (card) {
              setInfoCards((prev) => [...prev, card]);
            }
          }
          break;
        case "play_audio":
          if (payload) {
            // Parse payload - can be JSON object with text and voice, or plain text string
            let text = payload;
            let voice: string | undefined;

            try {
              const parsed = JSON.parse(payload);
              if (typeof parsed === "object" && parsed.text) {
                text = parsed.text;
                voice = parsed.voice ?? currentVoice ?? undefined;
              }
            } catch {
              // Not JSON, use as plain text
              voice = currentVoice ?? undefined;
            }

            console.log("[Avatar] play_audio: requesting TTS", { characters: text.length, voice });
            if (await speak(text, voice)) {
              console.log("[Avatar] Audio playback finished");
            }
          }
          break;
        case "settings_changed":
          if (payload) {
            try {
              const settings = JSON.parse(payload);
              if (settings.voice !== undefined) {
                setCurrentVoice(settings.voice);
              }
              if (settings.characterId !== undefined) {
                setCurrentCharacter(settings.characterId);
              }
            } catch {
              // Invalid JSON
            }
          }
          break;
        case "speaking_start":
          setIsSpeaking(true);
          break;
        case "speaking_end":
          setIsSpeaking(false);
          setMouthOpenness(0);
          break;
        case "mic_start":
          setSpeechEnabled(true);
          start();
          break;
        case "mic_stop":
          setSpeechEnabled(false);
          stop();
          break;
        case "mic_request_status":
          // Respond to control panel status request
          broadcastMicStatus(speechEnabled, isListening);
          break;
        case "effect":
          if (payload === "confetti" || payload === "hearts" || payload === "sparkles") {
            setEffectType(payload as EffectType);
            setShowEffect(true);
          }
          break;
        case "camera_capture_response":
          // Handle camera capture response from vision companion plugin
          if (pendingCaptureRef.current) {
            clearTimeout(pendingCaptureRef.current.timeout);
            pendingCaptureRef.current.resolve(payload as string | null);
            pendingCaptureRef.current = null;
          }
          break;
      }
    },
    [speak, start, stop, broadcastMicStatus, speechEnabled, isListening, currentVoice]
  );

  // Callback ref, so the channel below can stay open while the handler changes
  const handleChannelMessageRef = useRef(handleChannelMessage);

  useEffect(() => {
    handleChannelMessageRef.current = handleChannelMessage;
  }, [handleChannelMessage]);

  // Receive messages via BroadcastChannel
  useEffect(() => {
    const channel = new BroadcastChannel("mirror-channel");
    channel.onmessage = (event: MessageEvent<BroadcastMessage>) => handleChannelMessageRef.current(event);
    channelRef.current = channel;

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

  // Close the AudioContext only when leaving the page: replies play through it
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animationRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Show idle hint when in wake word waiting mode
  const showIdleHint = isWakeWordEnabled && wakeWordMode === "waiting" && !isSpeaking && !isThinking;

  return (
    <main
      className="h-screen w-screen bg-black flex flex-col items-center overflow-hidden relative cursor-pointer"
      onClick={initAudioContext}
    >
      {/* Parallax Background */}
      <div className="parallax-container">
        <div className="parallax-layer parallax-layer-1" />
        <div className="parallax-layer parallax-layer-2" />
      </div>

      {/* Light Streak */}
      <div className="light-streak" />

      {/* Effects */}
      <Confetti isActive={showEffect} effectType={effectType} onComplete={() => setShowEffect(false)} />

      {/* MIC OFF Notice */}
      {showMicOffNotice && (
        <div className="mic-off-notice fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
          <span className="text-white/50 text-2xl font-light tracking-widest">MIC OFF</span>
        </div>
      )}

      {/* First Run Notice */}
      {isFirstRun && (
        <div className="fixed bottom-8 right-8 text-white/50 text-sm animate-fade-in z-40">
          {t("firstRunNotice")}
        </div>
      )}

      {/* Idle Hint */}
      {showIdleHint && (
        <div className="idle-hint fixed top-16 left-1/2 -translate-x-1/2 z-30">
          <span className="text-white/40 text-sm font-light tracking-wide">
            {t("wakeWordPrompt", { phrase: wakeWordConfig?.phrase ?? "Hey Mira" })}
          </span>
        </div>
      )}

      {/* Mic Status Indicator */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        {!speechEnabled ? (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-zinc-600 rounded-full" />
            <span className="text-white/30 text-xs">{t("off")}</span>
          </div>
        ) : isListening ? (
          <div className="flex items-center gap-2">
            {isWakeWordEnabled && wakeWordMode === "waiting" ? (
              <>
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                <span className="text-white/50 text-xs">
                  {t("wakeWordPrompt", { phrase: wakeWordConfig?.phrase ?? "" })}
                </span>
              </>
            ) : isWakeWordEnabled && wakeWordMode === "conversation" ? (
              <>
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-white/50 text-xs">{t("inConversation")}</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-white/50 text-xs">{t("listening")}</span>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-yellow-500 rounded-full" />
            <span className="text-white/50 text-xs">{t("paused")}</span>
          </div>
        )}
      </div>

      {/* Why voice isn't working, under the mic status */}
      <ServiceErrorList
        errors={serviceErrorList}
        className="absolute top-10 right-4 max-w-sm space-y-1 text-right text-xs text-red-300/80 z-30"
      />

      {/* User Message - Top */}
      <div className="w-full h-[15%] flex items-end justify-center px-8 pb-4">
        {(userText || interimText) && (
          <p
            className={`text-white/50 text-base text-center font-light tracking-wide max-w-xl transition-opacity duration-2000 ${
              isTextFading ? "opacity-0" : "opacity-100"
            }`}
          >
            {userText || <span className="text-white/30 italic">{interimText}</span>}
          </p>
        )}
      </div>

      {/* Avatar - Center */}
      <div className="w-full h-[55%] relative">
        {/* Avatar with slide animation */}
        <div
          className={`absolute inset-0 transition-transform duration-500 ease-out ${
            infoCards.length > 0 ? "-translate-x-[15%]" : "translate-x-0"
          }`}
        >
          <SimpleAvatar
            isSpeaking={isSpeaking}
            isThinking={isThinking}
            mouthOpenness={mouthOpenness}
            avatarState={effectiveAvatarState}
            animationParams={animationParams}
          />
        </div>
        {/* Floating Info Cards */}
        <FloatingInfo cards={infoCards} onDismiss={dismissInfoCard} autoHideDuration={10000} />
      </div>

      {/* Response Text - Bottom 30% */}
      <div className="w-full h-[30%] flex items-start justify-center px-8 pt-6">
        <div className="w-2/3 flex flex-col items-center">
          {isThinking && !displayText ? (
            <div className="flex gap-2">
              <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          ) : displayText ? (
            <p
              className={`text-white/90 text-xl text-center font-light tracking-wide leading-relaxed text-enter transition-opacity duration-2000 ${
                isTextFading ? "opacity-0" : "opacity-100"
              }`}
            >
              {displayText}
            </p>
          ) : null}
        </div>
      </div>

      {/* Plugin Widgets */}
      <PluginRenderer />
    </main>
  );
}
