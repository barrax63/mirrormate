"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LiveTranscript } from "@/lib/live/transcript";
import type { LiveClientConfig } from "@/lib/live/types";
import { routeErrorFrom, type RouteError } from "@/lib/errors/service-errors";

export type LiveStatus = "off" | "connecting" | "live";

/** Why a session ended. Only "failed" means it never got going. */
export type LiveEndReason = "failed" | "idle" | "max" | "closed" | "stopped";

interface UseLiveSessionOptions {
  /** From GET /api/live. Nothing starts while it's missing or off. */
  config: LiveClientConfig | null;
  /** The page's AudioContext, for the lip sync analyser */
  getAudioContext: () => AudioContext;
  /** The current user turn so far */
  onUserText: (text: string) => void;
  /** The current reply so far */
  onAssistantText: (text: string) => void;
  onSpeakingChange: (speaking: boolean) => void;
  /** 0 to 1, as the reply's audio plays */
  onMouth: (openness: number) => void;
  /** The session is up */
  onStarted: () => void;
  /** Why it couldn't start, for the error line */
  onError: (error: RouteError) => void;
  onEnd: (reason: LiveEndReason) => void;
}

interface UseLiveSessionReturn {
  status: LiveStatus;
  start: (characterId: string | null) => void;
  stop: () => void;
}

interface Session {
  ended: boolean;
  startedAt: number;
  /** When something was last heard or said, from Date.now() */
  lastActivity: number;
  transcript: LiveTranscript;
  /** Whether any of the reply's audio has played yet */
  audioPlayed?: boolean;
  mic?: MediaStream;
  pc?: RTCPeerConnection;
  channel?: RTCDataChannel;
  audio?: HTMLAudioElement;
  source?: MediaStreamAudioSourceNode;
  timer?: ReturnType<typeof setInterval>;
  frame?: number;
}

// The reply's audio counts as speech above this RMS, and as done after this much quiet
const SPEAKING_RMS = 0.02;
const SPEAKING_HANGOVER_MS = 400;

/**
 * A GPT-Live session for live mode: the mic goes to OpenAI over WebRTC, and the reply comes
 * back as audio, which plays and moves the avatar's mouth, and as transcripts. The page
 * closes the session after config.idleTimeout without speech, after config.maxDuration, or
 * on stop(), since every open second is billed. What was said then goes to memory extraction.
 */
export function useLiveSession(options: UseLiveSessionOptions): UseLiveSessionReturn {
  const [status, setStatus] = useState<LiveStatus>("off");
  const sessionRef = useRef<Session | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const finish = useCallback((session: Session, reason: LiveEndReason) => {
    if (session.ended) return;
    session.ended = true;
    console.log(`[Live] Session ended: ${reason}`);

    if (session.timer) clearInterval(session.timer);
    if (session.frame !== undefined) cancelAnimationFrame(session.frame);
    try {
      if (session.channel?.readyState === "open") {
        session.channel.send(JSON.stringify({ type: "session.close" }));
      }
    } catch {
      // Closing the connection below ends the session too
    }
    // Gives the close a moment to go out before the connection goes
    const pc = session.pc;
    setTimeout(() => pc?.close(), 300);
    session.mic?.getTracks().forEach((track) => track.stop());
    if (session.audio) {
      session.audio.pause();
      session.audio.srcObject = null;
    }
    session.source?.disconnect();

    const { onMouth, onSpeakingChange, onEnd } = optionsRef.current;
    onMouth(0);
    onSpeakingChange(false);

    const messages = session.transcript.messages();
    if (messages.length > 0) {
      fetch("/api/live/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      }).catch(() => {
        // Only memory extraction is lost
      });
    }

    if (sessionRef.current === session) {
      sessionRef.current = null;
      setStatus("off");
    }
    onEnd(reason);
  }, []);

  // Plays the reply, and measures it for the mouth and the speaking state
  const playRemote = useCallback((session: Session, stream: MediaStream) => {
    if (session.ended) return;
    const audio = new Audio();
    audio.srcObject = stream;
    session.audio = audio;
    audio.play().catch((error) => console.warn("[Live] Couldn't play the session's audio:", error?.name));

    const context = optionsRef.current.getAudioContext();
    if (context.state === "suspended") context.resume().catch(() => {});
    // Only measured here: the audio element plays it, and Chrome only starts a remote stream
    // that a media element plays
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);
    session.source = source;

    const frequencies = new Uint8Array(analyser.frequencyBinCount);
    const samples = new Uint8Array(analyser.fftSize);
    let speaking = false;
    let quietSince = 0;
    const measure = () => {
      if (session.ended) return;
      const { onMouth, onSpeakingChange } = optionsRef.current;

      analyser.getByteFrequencyData(frequencies);
      const voiceRange = Math.floor(frequencies.length * 0.3);
      let sum = 0;
      for (let i = 0; i < voiceRange; i++) sum += frequencies[i];
      // The same mapping as for ElevenLabs replies
      onMouth(Math.min(1, Math.max(0, (sum / voiceRange - 60) / 80)));

      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) energy += ((sample - 128) / 128) ** 2;
      const now = performance.now();
      if (Math.sqrt(energy / samples.length) > SPEAKING_RMS) {
        quietSince = 0;
        session.lastActivity = Date.now();
        if (!speaking) {
          speaking = true;
          onSpeakingChange(true);
          if (!session.audioPlayed) {
            session.audioPlayed = true;
            console.log("[Live] Reply audio playing");
          }
        }
      } else if (speaking) {
        if (!quietSince) {
          quietSince = now;
        } else if (now - quietSince > SPEAKING_HANGOVER_MS) {
          speaking = false;
          onSpeakingChange(false);
          onMouth(0);
        }
      }
      session.frame = requestAnimationFrame(measure);
    };
    measure();
  }, []);

  const handleEvent = useCallback(
    (session: Session, data: unknown) => {
      if (session.ended || typeof data !== "string") return;
      let event: { type?: string; delta?: unknown; reason?: string; usage?: { seconds?: number }; error?: { code?: string; type?: string } };
      try {
        event = JSON.parse(data);
      } catch {
        return;
      }
      const { onUserText, onAssistantText, onStarted } = optionsRef.current;
      switch (event.type) {
        case "session.started":
          console.log("[Live] Session started");
          setStatus("live");
          onStarted();
          break;
        case "session.input_transcript.delta":
          if (typeof event.delta === "string") {
            session.lastActivity = Date.now();
            onUserText(session.transcript.add("user", event.delta));
          }
          break;
        case "session.output_transcript.delta":
          if (typeof event.delta === "string") {
            session.lastActivity = Date.now();
            onAssistantText(session.transcript.add("assistant", event.delta));
          }
          break;
        case "session.closed":
          console.log(`[Live] Closed by OpenAI: ${event.reason}, ${event.usage?.seconds} s`);
          finish(session, "closed");
          break;
        case "error":
          // The code only: a message could quote what was said
          console.error("[Live] Session error:", event.error?.code, event.error?.type);
          break;
      }
    },
    [finish]
  );

  const start = useCallback(
    (characterId: string | null) => {
      const config = optionsRef.current.config;
      if (sessionRef.current || !config?.enabled) return;

      const now = Date.now();
      const session: Session = { ended: false, startedAt: now, lastActivity: now, transcript: new LiveTranscript() };
      sessionRef.current = session;
      setStatus("connecting");

      // Counts from now, so a session that never connects is closed too
      session.timer = setInterval(() => {
        const time = Date.now();
        if (time - session.startedAt > config.maxDuration * 1000) {
          finish(session, "max");
        } else if (time - session.lastActivity > config.idleTimeout * 1000) {
          finish(session, "idle");
        }
      }, 1000);

      (async () => {
        // Where it failed, for the error line: the browser, the app's server, or OpenAI's answer
        let failure: RouteError = { code: "failed" };
        try {
          const mic = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          session.mic = mic;
          if (session.ended) {
            mic.getTracks().forEach((track) => track.stop());
            return;
          }

          const pc = new RTCPeerConnection();
          session.pc = pc;
          mic.getTracks().forEach((track) => pc.addTrack(track, mic));
          pc.ontrack = (event) => {
            if (event.streams[0]) playRemote(session, event.streams[0]);
          };
          pc.onconnectionstatechange = () => {
            if (pc.connectionState === "failed") finish(session, "closed");
          };
          const channel = pc.createDataChannel("oai-events");
          session.channel = channel;
          channel.onmessage = (event) => handleEvent(session, event.data);

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          failure = { code: "unavailable" };
          const response = await fetch("/api/live", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sdp: offer.sdp, characterId: characterId ?? undefined }),
          });
          if (session.ended) return;
          if (!response.ok) {
            const error = await routeErrorFrom(response);
            console.error("[Live] Couldn't create the session:", response.status, error);
            optionsRef.current.onError(error);
            finish(session, "failed");
            return;
          }
          failure = { code: "failed", service: "openai" };
          const { sdp } = await response.json();
          await pc.setRemoteDescription({ type: "answer", sdp });
        } catch (error) {
          if (session.ended) return;
          console.error("[Live] Couldn't start the session:", error instanceof Error ? error.name : error);
          optionsRef.current.onError(failure);
          finish(session, "failed");
        }
      })();
    },
    [finish, handleEvent, playRemote]
  );

  const stop = useCallback(() => {
    if (sessionRef.current) finish(sessionRef.current, "stopped");
  }, [finish]);

  // Leaving the page closes the session, or it would be billed until it expires
  useEffect(() => {
    const close = () => {
      if (sessionRef.current) finish(sessionRef.current, "stopped");
    };
    window.addEventListener("pagehide", close);
    return () => {
      window.removeEventListener("pagehide", close);
      close();
    };
  }, [finish]);

  return { status, start, stop };
}
