// What the pages know about failing requests, and when to ask again. Runs in the browser.
import {
  SERVICE_ERROR_CODES,
  SERVICES,
  type Service,
  type ServiceErrorCode,
} from "./service-error";

/**
 * What the pages ask for: wake word and speech transcripts, replies, speech output, and a GPT-Live
 * session in live mode
 */
export const VOICE_ROUTES = ["wakeWord", "speech", "chat", "tts", "live"] as const;

export type VoiceRoute = (typeof VOICE_ROUTES)[number];

export interface RouteError {
  code: ServiceErrorCode;
  service?: Service;
  /** Seconds the backend asked to wait before trying again */
  retryAfter?: number;
}

export interface RouteState {
  error: RouteError;
  /** Failures in a row that started a wait */
  backoffs: number;
  /** Until when requests on this route wait, from Date.now(). 0 when they don't. */
  until: number;
}

export interface RouteErrorEntry {
  route: VoiceRoute;
  error: RouteError;
}

/** What the pages report to, and ask before a request */
export interface ServiceErrorReporter {
  isBackingOff(route: VoiceRoute): boolean;
  failed(route: VoiceRoute, error: RouteError): void;
  succeeded(route: VoiceRoute): void;
}

// A missing or rejected key, no credit, a spending limit and rate limits don't go away within
// seconds, so asking again on every utterance would only repeat them
const BACKOFF_CODES: ReadonlySet<ServiceErrorCode> = new Set([
  "missing_key",
  "invalid_key",
  "missing_permissions",
  "quota_exceeded",
  "spend_limit_reached",
  "rate_limited",
]);
export const FIRST_BACKOFF_MS = 30_000;
export const MAX_BACKOFF_MS = 10 * 60_000;

const isCode = (value: unknown): value is ServiceErrorCode =>
  (SERVICE_ERROR_CODES as readonly unknown[]).includes(value);
const isService = (value: unknown): value is Service => (SERVICES as readonly unknown[]).includes(value);
export const isVoiceRoute = (value: unknown): value is VoiceRoute =>
  (VOICE_ROUTES as readonly unknown[]).includes(value);

function codeForStatus(status: number): ServiceErrorCode {
  if (status === 429) return "rate_limited";
  if (status >= 502 && status <= 504) return "unavailable";
  return "failed";
}

/** A RouteError from what a route sent, or null if it isn't one */
export function parseRouteError(value: unknown): RouteError | null {
  if (typeof value !== "object" || value === null) return null;
  const { code, service, retryAfter } = value as Record<string, unknown>;
  if (!isCode(code)) return null;
  return {
    code,
    ...(isService(service) && { service }),
    ...(typeof retryAfter === "number" && retryAfter > 0 && { retryAfter }),
  };
}

/** The error a route answered with, or one its status suggests if the body doesn't say */
export async function routeErrorFrom(response: Response): Promise<RouteError> {
  const body = await response.json().catch(() => null);
  return parseRouteError(body) ?? { code: codeForStatus(response.status) };
}

/** The latest error of each route, and how long to wait before asking again */
export class ServiceErrors {
  private readonly routes = new Map<VoiceRoute, RouteState>();
  private readonly listeners = new Set<() => void>();
  private snapshot: RouteErrorEntry[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  /** Current errors, in the same array until one changes */
  getSnapshot = (): RouteErrorEntry[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  states(): [VoiceRoute, RouteState][] {
    return [...this.routes];
  }

  isBackingOff(route: VoiceRoute): boolean {
    return this.now() < (this.routes.get(route)?.until ?? 0);
  }

  /** Records a failure, and returns the state it led to */
  failed(route: VoiceRoute, error: RouteError): RouteState {
    const backoffs = this.routes.get(route)?.backoffs ?? 0;
    let state: RouteState;
    if (BACKOFF_CODES.has(error.code)) {
      // A rate limit says how long to wait, and the others wait longer each time
      const wait = error.retryAfter
        ? error.retryAfter * 1000
        : Math.min(FIRST_BACKOFF_MS * 2 ** backoffs, MAX_BACKOFF_MS);
      state = { error, backoffs: backoffs + 1, until: this.now() + wait };
    } else {
      state = { error, backoffs, until: 0 };
    }
    this.set(route, state);
    return state;
  }

  /** Clears the route's error. Returns whether there was one. */
  succeeded(route: VoiceRoute): boolean {
    if (!this.routes.has(route)) return false;
    this.set(route, null);
    return true;
  }

  /** Takes the state as it is, as another page reported it */
  set(route: VoiceRoute, state: RouteState | null): void {
    if (state) {
      this.routes.set(route, state);
    } else {
      this.routes.delete(route);
    }
    this.snapshot = VOICE_ROUTES.flatMap((name) => {
      const current = this.routes.get(name);
      return current ? [{ route: name, error: current.error }] : [];
    });
    this.listeners.forEach((listener) => listener());
  }
}
