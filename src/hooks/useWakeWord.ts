"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export type WakeWordMode = "waiting" | "conversation";

interface WakeWordConfig {
  enabled: boolean;
  phrase: string;
  timeout: number;
}

interface UseWakeWordOptions {
  onWakeWordDetected?: () => void;
  onTimeout?: () => void;
}

interface UseWakeWordReturn {
  mode: WakeWordMode;
  config: WakeWordConfig | null;
  isEnabled: boolean;
  checkForWakeWord: (transcript: string) => boolean;
  startConversation: () => void;
  endConversation: () => void;
  resetTimeout: () => void;
}

export function useWakeWord({
  onWakeWordDetected,
  onTimeout,
}: UseWakeWordOptions = {}): UseWakeWordReturn {
  const [mode, setMode] = useState<WakeWordMode>("waiting");
  const [config, setConfig] = useState<WakeWordConfig | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch wake word config. Without one, the page treats everything heard as wake word audio,
  // so a default with the wake word off would send it all to stt.provider.
  useEffect(() => {
    async function fetchConfig() {
      try {
        const res = await fetch("/api/wakeword");
        if (!res.ok) {
          throw new Error(`Wake word config request failed: ${res.status}`);
        }
        const data: WakeWordConfig = await res.json();
        setConfig(data);
      } catch (error) {
        console.error("[WakeWord] Failed to fetch config:", error);
      }
    }
    fetchConfig();
  }, []);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Start conversation timeout
  const startConversationTimeout = useCallback(() => {
    if (!config) return;

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout
    timeoutRef.current = setTimeout(() => {
      console.log("[WakeWord] Conversation timeout, returning to waiting mode");
      setMode("waiting");
      onTimeout?.();
    }, config.timeout * 1000);
  }, [config, onTimeout]);

  // Check if transcript contains wake word
  const checkForWakeWord = useCallback(
    (transcript: string): boolean => {
      if (!config?.enabled || mode !== "waiting") {
        return false;
      }

      // Normalize both strings for comparison. Only letters and digits count,
      // since Whisper punctuates ("Hey, Mira!").
      const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      const normalizedTranscript = normalize(transcript);
      const normalizedPhrase = normalize(config.phrase);

      // Check if wake word is in transcript
      if (normalizedTranscript.includes(normalizedPhrase)) {
        console.log("[WakeWord] Wake word detected!");
        setMode("conversation");
        startConversationTimeout();
        onWakeWordDetected?.();
        return true;
      }

      return false;
    },
    [config, mode, startConversationTimeout, onWakeWordDetected]
  );

  // Manually start conversation mode
  const startConversation = useCallback(() => {
    setMode("conversation");
    startConversationTimeout();
  }, [startConversationTimeout]);

  // End conversation and return to waiting
  const endConversation = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setMode("waiting");
  }, []);

  // Reset timeout (call when user speaks)
  const resetTimeout = useCallback(() => {
    if (mode === "conversation") {
      startConversationTimeout();
    }
  }, [mode, startConversationTimeout]);

  return {
    mode,
    config,
    isEnabled: config?.enabled ?? false,
    checkForWakeWord,
    startConversation,
    endConversation,
    resetTimeout,
  };
}
