import { describe, it, expect, vi, afterEach } from "vitest";
import { getToolDefinitions, getTool } from "./index";
import type { ToolDefinition } from "./types";

const JAPANESE = /[぀-ヿ㐀-鿿]/;

function definitionsIn(locale: string): ToolDefinition[] {
  vi.stubEnv("LOCALE", locale);
  return getToolDefinitions();
}

// Names, parameters and enums, without the descriptions
function shape(definitions: ToolDefinition[]) {
  return definitions.map(({ name, parameters }) => ({
    name,
    required: parameters.required,
    properties: Object.entries(parameters.properties).map(([key, { type, enum: values }]) => ({ key, type, values })),
  }));
}

describe("tool definitions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("have no Japanese in English mode", () => {
    expect(JSON.stringify(definitionsIn("en"))).not.toMatch(JAPANESE);
  });

  it("describe show_effect and web_search in Japanese in Japanese mode", () => {
    const definitions = definitionsIn("ja");

    for (const name of ["show_effect", "web_search"]) {
      expect(definitions.find((definition) => definition.name === name)?.description).toMatch(JAPANESE);
    }
  });

  it("are the same tools in every locale, apart from the descriptions", () => {
    expect(shape(definitionsIn("ja"))).toEqual(shape(definitionsIn("en")));
  });

  it("are found by name in every locale", () => {
    vi.stubEnv("LOCALE", "ja");

    expect(getTool("show_effect")?.definition.name).toBe("show_effect");
  });
});
