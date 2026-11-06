import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSystemPrompt, getSystemPromptForCharacter, getCharacterPresets, clearCharacterCache, clearCharactersCache } from "./index";

const JAPANESE = /[぀-ヿ㐀-鿿]/;

// The committed config/locales/*/character.yaml and characters.yaml
describe("character prompts", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    clearCharacterCache();
    clearCharactersCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("have no Japanese in English mode, for every character", () => {
    vi.stubEnv("LOCALE", "en");

    const prompts = [getSystemPrompt(), ...getCharacterPresets().map((preset) => getSystemPromptForCharacter(preset.id))];

    for (const prompt of prompts) {
      expect(prompt).toMatch(/^You are .+\.\nYour name is ".+"\. You have .+\.\n\nPersonality:\n- /);
      expect(prompt).toContain("\n\nSpeech style:\n- ");
      expect(prompt).toContain("\n\nExamples:\n- \"");
      expect(prompt).toMatch(/Write plain spoken text only: no markdown, no lists, no emoji\.$/);
      expect(prompt).not.toMatch(JAPANESE);
    }
  });

  it("are in Japanese in Japanese mode, for every character", () => {
    vi.stubEnv("LOCALE", "ja");

    const prompts = [getSystemPrompt(), ...getCharacterPresets().map((preset) => getSystemPromptForCharacter(preset.id))];

    for (const prompt of prompts) {
      expect(prompt).toMatch(/^あなたは.+です。\n名前は「.+」。.+をしています。\n\n性格:\n- /);
      expect(prompt).toContain("\n\n話し方:\n- ");
      expect(prompt).toContain("\n\n例:\n- 「");
      expect(prompt).toMatch(/Markdown、箇条書き、絵文字は使わないでください。$/);
    }
  });

  it("are in German in German mode, for every character", () => {
    vi.stubEnv("LOCALE", "de");

    const prompts = [getSystemPrompt(), ...getCharacterPresets().map((preset) => getSystemPromptForCharacter(preset.id))];

    for (const prompt of prompts) {
      expect(prompt).toMatch(/^Du bist .+\.\nDein Name ist „.+“\. Du hast .+\.\n\nPersönlichkeit:\n- /);
      expect(prompt).toContain("\n\nSprechweise:\n- ");
      expect(prompt).toContain("\n\nBeispiele:\n- „");
      expect(prompt).toContain("\n\nVerhalten:\n- ");
      expect(prompt).toMatch(/Schreib nur gesprochenen Klartext: kein Markdown, keine Listen, keine Emojis\.$/);
      expect(prompt).not.toMatch(JAPANESE);
    }
  });

  it("list the behaviors under their heading", () => {
    vi.stubEnv("LOCALE", "en");

    expect(getSystemPrompt()).toMatch(/\n\nBehaviors:\n- When you search for information/);
  });
});
