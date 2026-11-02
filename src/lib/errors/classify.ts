import OpenAI from "openai";
import { NextResponse } from "next/server";
import { ServiceError, httpStatusFor, type Service, type ServiceErrorBody } from "./service-error";

/** Seconds from a Retry-After header, if it holds a number */
function retryAfterSeconds(headers: Headers | undefined): number | undefined {
  const seconds = Number(headers?.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function fromOpenAI(error: InstanceType<typeof OpenAI.APIError>): ServiceError {
  if (error instanceof OpenAI.APIConnectionError) {
    return new ServiceError("unavailable", "openai", error.message);
  }
  switch (error.status) {
    case 401:
      // Restricted keys get a 401 too, naming the scopes they lack
      return new ServiceError(
        /insufficient permissions|missing scopes/i.test(error.message) ? "missing_permissions" : "invalid_key",
        "openai",
        error.message
      );
    case 403:
      return new ServiceError("missing_permissions", "openai", error.message);
    case 429:
      // Out of credit is a 429 as well, and waiting won't help it
      return error.code === "insufficient_quota"
        ? new ServiceError("quota_exceeded", "openai", error.message)
        : new ServiceError("rate_limited", "openai", error.message, retryAfterSeconds(error.headers));
    case 502:
    case 503:
    case 504:
      return new ServiceError("unavailable", "openai", error.message);
    default:
      return new ServiceError("failed", "openai", error.message);
  }
}

/**
 * The ServiceError for whatever a request threw. `service` is the backend the route called,
 * named when fetch itself fails, since that error doesn't say where it was going.
 */
export function toServiceError(error: unknown, service?: Service): ServiceError {
  if (error instanceof ServiceError) {
    return error;
  }
  if (error instanceof OpenAI.APIError) {
    return fromOpenAI(error);
  }
  // fetch's own errors: refused or reset connections, and AbortSignal.timeout
  if (
    (error instanceof TypeError && error.message === "fetch failed") ||
    (error instanceof Error && error.name === "TimeoutError")
  ) {
    return new ServiceError("unavailable", service, error.message);
  }
  return new ServiceError("failed", undefined, error instanceof Error ? error.message : String(error));
}

/** Logs the error, and answers with its code, so the page can say what went wrong */
export function serviceErrorResponse(error: unknown, label: string, service?: Service): NextResponse<ServiceErrorBody> {
  console.error(`[${label}] Error:`, error);
  const { code, service: failedService, message, retryAfter } = toServiceError(error, service);
  return NextResponse.json(
    {
      error: message,
      code,
      ...(failedService && { service: failedService }),
      ...(retryAfter && { retryAfter }),
    },
    { status: httpStatusFor(code, failedService) }
  );
}
