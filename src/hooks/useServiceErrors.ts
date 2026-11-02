"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ServiceErrors,
  isVoiceRoute,
  parseRouteError,
  type RouteErrorEntry,
  type RouteState,
  type ServiceErrorReporter,
  type VoiceRoute,
} from "@/lib/errors/service-errors";

const NO_ERRORS: RouteErrorEntry[] = [];

function parseState(value: unknown): RouteState | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const { error, backoffs, until } = value as Record<string, unknown>;
  const routeError = parseRouteError(error);
  if (!routeError || typeof backoffs !== "number" || typeof until !== "number") return undefined;
  return { error: routeError, backoffs, until };
}

/**
 * Failed requests of this page and the others in the browser, which share them over
 * BroadcastChannel("mirror-channel"). So a failure on the avatar page shows on /control too,
 * and both wait as long before asking again.
 */
export function useServiceErrors(): { errors: RouteErrorEntry[]; reporter: ServiceErrorReporter } {
  const [tracker] = useState(() => new ServiceErrors());
  const channelRef = useRef<BroadcastChannel | null>(null);
  const errors = useSyncExternalStore(tracker.subscribe, tracker.getSnapshot, () => NO_ERRORS);

  useEffect(() => {
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel("mirror-channel");
    } catch {
      // BroadcastChannel not supported
      return;
    }
    channelRef.current = channel;

    const send = (route: VoiceRoute, state: RouteState | null) =>
      channel.postMessage({ type: "service_error", payload: JSON.stringify({ route, state }) });

    channel.onmessage = (event: MessageEvent<{ type?: string; payload?: unknown }>) => {
      const { type, payload } = event.data ?? {};
      if (type === "service_errors_request") {
        tracker.states().forEach(([route, state]) => send(route, state));
      } else if (type === "service_error" && typeof payload === "string") {
        try {
          const { route, state } = JSON.parse(payload);
          const parsed = parseState(state);
          if (isVoiceRoute(route) && parsed !== undefined) {
            tracker.set(route, parsed);
          }
        } catch {
          // Not a message from this hook
        }
      }
    };

    // A page opened later learns what already failed
    channel.postMessage({ type: "service_errors_request" });

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [tracker]);

  const reporter = useMemo<ServiceErrorReporter>(() => {
    const send = (route: VoiceRoute, state: RouteState | null) =>
      channelRef.current?.postMessage({ type: "service_error", payload: JSON.stringify({ route, state }) });
    return {
      isBackingOff: (route) => tracker.isBackingOff(route),
      failed: (route, error) => send(route, tracker.failed(route, error)),
      succeeded: (route) => {
        if (tracker.succeeded(route)) send(route, null);
      },
    };
  }, [tracker]);

  return { errors, reporter };
}
