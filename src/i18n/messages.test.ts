import { describe, it, expect } from "vitest";
import en from "../../messages/en.json";
import ja from "../../messages/ja.json";
import { SERVICES, SERVICE_ERROR_CODES } from "@/lib/errors/service-error";
import { VOICE_ROUTES } from "@/lib/errors/service-errors";

/** Every key path in a messages file, such as "errors.codes.failed" */
function keys(messages: object, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === "object" ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`]
  );
}

describe("messages", () => {
  it("has the same keys in every language", () => {
    expect(keys(ja).sort()).toEqual(keys(en).sort());
  });

  it("has a text for every error code, route and service the pages can show", () => {
    const expected = [
      ...SERVICE_ERROR_CODES.map((code) => `errors.codes.${code}`),
      ...VOICE_ROUTES.map((route) => `errors.routes.${route}`),
      ...[...SERVICES, "app"].map((service) => `errors.services.${service}`),
    ];

    expect(keys(en)).toEqual(expect.arrayContaining(expected));
  });
});
