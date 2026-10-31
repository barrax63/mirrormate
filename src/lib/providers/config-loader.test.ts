import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearProvidersConfigCache, loadProvidersConfig } from "./config-loader";
import { clearPresetCache } from "../presets";

describe("loadProvidersConfig", () => {
  let tempDirs: string[];

  beforeEach(() => {
    tempDirs = [];
    clearProvidersConfigCache();
    clearPresetCache();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  });

  // Makes the loader read this YAML from a temporary config/ directory
  function useProvidersYaml(contents?: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirrormate-config-"));
    tempDirs.push(dir);
    fs.mkdirSync(path.join(dir, "config"));
    if (contents !== undefined) {
      fs.writeFileSync(path.join(dir, "config", "providers.yaml"), contents);
    }
    vi.spyOn(process, "cwd").mockReturnValue(dir);
  }

  describe("with the committed config", () => {
    it("applies the locale preset to the Whisper providers", () => {
      vi.stubEnv("LOCALE", "ja");
      expect(loadProvidersConfig().providers?.stt?.local?.language).toBe("ja");

      clearProvidersConfigCache();
      vi.stubEnv("LOCALE", "en");
      expect(loadProvidersConfig().providers?.stt?.local?.language).toBe("en");
    });

    // Known bug: `web:` parses to null, so the preset is skipped. Remove .fails when
    // the loader defaults stt.web to an object.
    it.fails("applies the locale preset to Web Speech", () => {
      vi.stubEnv("LOCALE", "ja");

      expect(loadProvidersConfig().providers?.stt?.web?.language).toBe("ja-JP");
    });

    it("lets the environment choose the providers", () => {
      vi.stubEnv("LLM_PROVIDER", "openai");
      vi.stubEnv("TTS_PROVIDER", "voicevox");
      vi.stubEnv("STT_PROVIDER", "local");

      const { providers } = loadProvidersConfig();

      expect(providers?.llm?.provider).toBe("openai");
      expect(providers?.tts?.provider).toBe("voicevox");
      expect(providers?.stt?.provider).toBe("local");
    });
  });

  it("keeps an explicit Web Speech language", () => {
    vi.stubEnv("LOCALE", "ja");
    useProvidersYaml("providers:\n  stt:\n    provider: web\n    web:\n      language: de-DE\n");

    expect(loadProvidersConfig().providers?.stt?.web?.language).toBe("de-DE");
  });

  it("fills an empty Web Speech language from the preset", () => {
    vi.stubEnv("LOCALE", "ja");
    useProvidersYaml("providers:\n  stt:\n    provider: web\n    web:\n      language: ''\n");

    expect(loadProvidersConfig().providers?.stt?.web?.language).toBe("ja-JP");
  });

  it("falls back to OpenAI when the file is missing", () => {
    useProvidersYaml();

    const { providers } = loadProvidersConfig();

    expect(providers?.llm?.provider).toBe("openai");
    expect(providers?.tts?.provider).toBe("openai");
  });
});
