import { describe, it, expect, vi, afterEach } from "vitest";
import { getToolDefinitions, getTool, executeTool } from "./index";
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

  it("have no Japanese in English or German mode", () => {
    expect(JSON.stringify(definitionsIn("en"))).not.toMatch(JAPANESE);
    expect(JSON.stringify(definitionsIn("de"))).not.toMatch(JAPANESE);
  });

  it("describe every tool and parameter in Japanese in Japanese mode", () => {
    const definitions = definitionsIn("ja");

    expect(definitions.map((definition) => definition.name)).toEqual([
      "see_camera",
      "web_search",
      "show_effect",
      "share_to_discord",
    ]);
    for (const { name, description, parameters } of definitions) {
      expect(description, name).toMatch(JAPANESE);
      for (const [key, property] of Object.entries(parameters.properties)) {
        expect(property.description, `${name}.${key}`).toMatch(JAPANESE);
      }
    }
  });

  it("are the same tools in every locale, apart from the descriptions", () => {
    expect(shape(definitionsIn("ja"))).toEqual(shape(definitionsIn("en")));
    expect(shape(definitionsIn("de"))).toEqual(shape(definitionsIn("en")));
  });

  it("answer in the locale's language", async () => {
    vi.stubEnv("LOCALE", "ja");

    expect(await executeTool({ id: "1", name: "show_effect", arguments: { effect: "hearts" } })).toMatchObject({
      result: "heartsエフェクトを表示中",
    });
    expect(await executeTool({ id: "2", name: "no_such_tool", arguments: {} })).toMatchObject({
      result: "ツール「no_such_tool」が見つかりません。",
    });
    expect(await executeTool({ id: "3", name: "web_search", arguments: {} })).toMatchObject({
      result: "検索クエリがありません。",
    });
  });

  it("are found by name in every locale", () => {
    vi.stubEnv("LOCALE", "ja");

    expect(getTool("show_effect")?.definition.name).toBe("show_effect");
  });
});
