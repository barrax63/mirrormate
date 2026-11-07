"use client";

import { useState, useEffect, useCallback } from "react";
import type { BroadcastMessage } from "@/lib/broadcast";

const STORAGE_KEY = "mirrormate:vision";

/**
 * The Vision setting: whether the camera may run, and frames go with questions. Saved in the
 * settings, with localStorage as the fallback, and shared between pages with vision_toggle.
 *
 * null until loaded. Callers treat that as off, so the camera never starts before the setting
 * is known.
 */
export function useVisionEnabled(): {
  visionEnabled: boolean | null;
  setVisionEnabled: (enabled: boolean) => void;
} {
  const [visionEnabled, setVisionEnabledState] = useState<boolean | null>(null);

  // Load from DB, with localStorage as the fallback
  useEffect(() => {
    let cancelled = false;

    async function load() {
      let enabled: boolean | null = null;
      try {
        const response = await fetch("/api/settings");
        if (response.ok) {
          const data = await response.json();
          if (typeof data.visionEnabled === "boolean") enabled = data.visionEnabled;
        }
      } catch {
        // Fall back to localStorage
      }

      if (enabled === null) {
        const stored = localStorage.getItem(STORAGE_KEY);
        // On unless it was turned off, as before the setting existed
        enabled = stored !== "off";
      } else {
        localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
      }

      if (!cancelled) setVisionEnabledState((current) => current ?? enabled);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Follow changes made on another page
  useEffect(() => {
    const channel = new BroadcastChannel("mirror-channel");
    channel.onmessage = (event) => {
      if (event.data?.type === "vision_toggle") {
        setVisionEnabledState(event.data.payload === "on");
      }
    };
    return () => channel.close();
  }, []);

  const setVisionEnabled = useCallback((enabled: boolean) => {
    setVisionEnabledState(enabled);
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");

    // Save to DB
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visionEnabled: enabled }),
    }).catch(() => {
      // Ignore DB errors, localStorage is the backup
    });

    // Notify the avatar page and its camera
    try {
      const channel = new BroadcastChannel("mirror-channel");
      channel.postMessage({ type: "vision_toggle", payload: enabled ? "on" : "off" } satisfies BroadcastMessage);
      channel.close();
    } catch {
      // BroadcastChannel not supported
    }
  }, []);

  return { visionEnabled, setVisionEnabled };
}
