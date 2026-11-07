import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getSystemPrompt,
  getSystemPromptForCharacter,
  getCharacterPresets,
  getWakeWordConfig,
  clearCharacterCache,
  clearCharactersCache,
} from "./index";

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

  it("list the behaviors under their heading", () => {
    vi.stubEnv("LOCALE", "en");

    expect(getSystemPrompt()).toMatch(/\n\nBehaviors:\n- When you search for information/);
  });
});

// The committed config/locales/*/character.yaml and characters.yaml
describe("getWakeWordConfig", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    clearCharacterCache();
    clearCharactersCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("takes the picked character's phrase, and character.yaml's switch and timeout", () => {
    vi.stubEnv("LOCALE", "en");

    expect(getWakeWordConfig()).toEqual({ enabled: true, phrase: "Hey Mira", timeout: 60 });
    expect(getWakeWordConfig("luna")).toEqual({ enabled: true, phrase: "Hey Luna", timeout: 60 });
    expect(getWakeWordConfig("sora")).toEqual({ enabled: true, phrase: "Hey Sora", timeout: 60 });
    expect(getWakeWordConfig("nobody")).toEqual({ enabled: true, phrase: "Hey Mira", timeout: 60 });
  });

  it("gives every character a phrase in every locale", () => {
    for (const locale of ["en", "ja"]) {
      vi.stubEnv("LOCALE", locale);
      clearCharactersCache();

      for (const preset of getCharacterPresets()) {
        expect(preset.wakeWord?.phrase, `${locale} ${preset.id}`).toBeTruthy();
      }
    }
    expect(getWakeWordConfig("luna").phrase).toBe("OK ルナ");
  });
});
