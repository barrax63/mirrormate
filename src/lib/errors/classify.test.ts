import OpenAI from "openai";
import { describe, it, expect, vi, afterEach } from "vitest";
import { serviceErrorResponse, toServiceError } from "./classify";
import { ServiceError } from "./service-error";

const openAIError = (status: number, error: Record<string, unknown>, headers: Record<string, string> = {}) =>
  OpenAI.APIError.generate(status, { error }, undefined, new Headers(headers));

describe("toServiceError", () => {
  it.each([
    [401, { message: "Incorrect API key provided", code: "invalid_api_key" }, "invalid_key"],
    [
      401,
      { message: "You have insufficient permissions for this operation. Missing scopes: model.request" },
      "missing_permissions",
    ],
    [403, { message: "Project does not have access to model" }, "missing_permissions"],
    [429, { message: "You exceeded your current quota", code: "insufficient_quota" }, "quota_exceeded"],
    [429, { message: "Project spend limit reached", code: "project_spend_limit_exceeded" }, "spend_limit_reached"],
    [429, { message: "Organization spend limit reached", code: "organization_spend_limit_exceeded" }, "spend_limit_reached"],
    [429, { message: "Rate limit reached", code: "rate_limit_exceeded" }, "rate_limited"],
    [500, { message: "The server had an error" }, "failed"],
    [503, { message: "Service unavailable" }, "unavailable"],
  ])("reads OpenAI's %i %j as %s", (status, error, code) => {
    expect(toServiceError(openAIError(status, error))).toMatchObject({ code, service: "openai" });
  });

  it("passes on how long OpenAI asks to wait", () => {
    const error = openAIError(429, { code: "rate_limit_exceeded" }, { "retry-after": "7" });

    expect(toServiceError(error).retryAfter).toBe(7);
  });

  it("calls OpenAI unavailable when it can't be reached", () => {
    const error = new OpenAI.APIConnectionError({ message: "Connection error." });

    expect(toServiceError(error)).toMatchObject({ code: "unavailable", service: "openai" });
  });

  it("names the service a failed fetch was on its way to", () => {
    expect(toServiceError(new TypeError("fetch failed"), "ollama")).toMatchObject({
      code: "unavailable",
      service: "ollama",
    });
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect(toServiceError(timeout, "elevenlabs")).toMatchObject({ code: "unavailable", service: "elevenlabs" });
  });

  it("blames no service for other errors, which are the app's own", () => {
    expect(toServiceError(new Error("something broke"), "openai")).toMatchObject({
      code: "failed",
      service: undefined,
      message: "something broke",
    });
  });

  it("keeps a ServiceError as it is", () => {
    const error = new ServiceError("missing_key", "elevenlabs", "ELEVENLABS_API_KEY is not configured");

    expect(toServiceError(error)).toBe(error);
  });
});

describe("serviceErrorResponse", () => {
  afterEach(() => vi.restoreAllMocks());

  it("answers with the code, the service and a status to match", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = serviceErrorResponse(openAIError(429, { code: "rate_limit_exceeded" }, { "retry-after": "3" }), "Test");

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "rate_limited", service: "openai", retryAfter: 3 });
  });

  it("answers the app's own errors with a 500 and no service", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = serviceErrorResponse(new Error("something broke"), "Test");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "something broke", code: "failed" });
  });
});
