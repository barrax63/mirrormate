// Why a request to a backend failed, as the API routes tell the pages. Used on both sides, so
// it imports nothing server-only.

/** Each one has its own message, under errors.codes in messages/*.json */
export const SERVICE_ERROR_CODES = [
  "missing_key",
  "invalid_key",
  "missing_permissions",
  "quota_exceeded",
  "rate_limited",
  "unavailable",
  "failed",
] as const;

export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number];

/** The backends the messages name. An error without one is the app's own. */
export const SERVICES = ["openai", "elevenlabs", "localWhisper", "ollama"] as const;

export type Service = (typeof SERVICES)[number];

/** What a route answers with when a request fails */
export interface ServiceErrorBody {
  error: string;
  code: ServiceErrorCode;
  service?: Service;
  /** Seconds the backend asked to wait before trying again */
  retryAfter?: number;
}

export class ServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    readonly service: Service | undefined,
    message: string,
    readonly retryAfter?: number
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

/** The status a route answers with for an error */
export function httpStatusFor(code: ServiceErrorCode, service?: Service): number {
  switch (code) {
    case "missing_key":
      return 500;
    case "invalid_key":
    case "missing_permissions":
    case "quota_exceeded":
      return 502;
    case "rate_limited":
      return 429;
    case "unavailable":
      return 503;
    case "failed":
      // A backend's error, or the app's own
      return service ? 502 : 500;
  }
}
