"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { routeErrorFrom, type ServiceErrorReporter } from "@/lib/errors/service-errors";

export interface Voice {
  id: string;
  name: string;
}

interface UseVoiceSelectorReturn {
  voices: Voice[];
  selectedVoice: string | null;
  setSelectedVoice: (id: string) => void;
  isLoading: boolean;
  /** True when the voices couldn't be loaded */
  error: boolean;
  previewVoice: (voiceId: string, text: string) => Promise<void>;
  isPreviewPlaying: boolean;
}

const STORAGE_KEY = "mirrormate:voice";
// Held a speaker number from the old speech engine, which means nothing to ElevenLabs
const OLD_STORAGE_KEY = "mirrormate:speaker";

interface UseVoiceSelectorOptions {
  /** Told how each preview's speech request went */
  serviceErrors?: ServiceErrorReporter;
}

export function useVoiceSelector({ serviceErrors }: UseVoiceSelectorOptions = {}): UseVoiceSelectorReturn {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoiceState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const settingsLoadedRef = useRef(false);

  // Load voices from API
  useEffect(() => {
    async function fetchVoices() {
      try {
        const response = await fetch("/api/voices");
        const data = await response.json();
        setVoices(data.voices || []);
        setError(!response.ok);
      } catch {
        setVoices([]);
        setError(true);
      } finally {
        setIsLoading(false);
      }
    }

    fetchVoices();
  }, []);

  // Load selected voice from DB (with localStorage fallback)
  useEffect(() => {
    if (settingsLoadedRef.current) return;
    settingsLoadedRef.current = true;
    localStorage.removeItem(OLD_STORAGE_KEY);

    async function loadSettings() {
      try {
        const response = await fetch("/api/settings");
        if (response.ok) {
          const data = await response.json();
          if (data.voice) {
            setSelectedVoiceState(data.voice);
            localStorage.setItem(STORAGE_KEY, data.voice);
            return;
          }
        }
      } catch {
        // Fall back to localStorage
      }

      // Fallback to localStorage
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setSelectedVoiceState(stored);
      }
    }

    loadSettings();
  }, []);

  const setSelectedVoice = useCallback((id: string) => {
    setSelectedVoiceState(id);
    localStorage.setItem(STORAGE_KEY, id);

    // Save to DB
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice: id }),
    }).catch(() => {
      // Ignore DB errors, localStorage is the backup
    });

    // Notify other tabs via BroadcastChannel
    try {
      const channel = new BroadcastChannel("mirror-channel");
      channel.postMessage({
        type: "settings_changed",
        payload: JSON.stringify({ voice: id }),
      });
      channel.close();
    } catch {
      // BroadcastChannel not supported
    }
  }, []);

  const previewVoice = useCallback(async (voiceId: string, text: string) => {
    if (isPreviewPlaying) return;

    setIsPreviewPlaying(true);

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: voiceId }),
      });

      if (!response.ok) {
        const error = await routeErrorFrom(response);
        console.error("Preview failed:", response.status, error);
        serviceErrors?.failed("tts", error);
        setIsPreviewPlaying(false);
        return;
      }

      serviceErrors?.succeeded("tts");
      const data = await response.json();

      if (data.audio) {
        // Stop any existing audio
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }

        const audio = new Audio(`data:audio/mpeg;base64,${data.audio}`);
        audioRef.current = audio;

        audio.onended = () => {
          setIsPreviewPlaying(false);
          audioRef.current = null;
        };

        audio.onerror = () => {
          setIsPreviewPlaying(false);
          audioRef.current = null;
        };

        await audio.play();
      } else {
        setIsPreviewPlaying(false);
      }
    } catch {
      console.error("Preview failed");
      setIsPreviewPlaying(false);
    }
  }, [isPreviewPlaying, serviceErrors]);

  return {
    voices,
    selectedVoice,
    setSelectedVoice,
    isLoading,
    error,
    previewVoice,
    isPreviewPlaying,
  };
}
