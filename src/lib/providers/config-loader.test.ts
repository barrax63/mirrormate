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

    it("lets the environment choose the LLM and STT providers", () => {
      vi.stubEnv("LLM_PROVIDER", "openai");
      vi.stubEnv("STT_PROVIDER", "local");

      const { providers } = loadProvidersConfig();

      expect(providers?.llm?.provider).toBe("openai");
      expect(providers?.stt?.provider).toBe("local");
    });

    // ElevenLabs is the only TTS provider left
    it("ignores TTS_PROVIDER", () => {
      vi.stubEnv("TTS_PROVIDER", "openai");

      expect(loadProvidersConfig().providers?.tts?.provider).toBe("elevenlabs");
    });
  });

  it("keeps an explicit Whisper language", () => {
    vi.stubEnv("LOCALE", "ja");
    useProvidersYaml("providers:\n  stt:\n    provider: local\n    local:\n      language: de\n");

    expect(loadProvidersConfig().providers?.stt?.local?.language).toBe("de");
  });

  it("fills an empty Whisper language from the preset", () => {
    vi.stubEnv("LOCALE", "ja");
    useProvidersYaml("providers:\n  stt:\n    provider: local\n    local:\n      language: ''\n");

    expect(loadProvidersConfig().providers?.stt?.local?.language).toBe("ja");
  });

  it("falls back to OpenAI and ElevenLabs when the file is missing", () => {
    useProvidersYaml();

    const { providers } = loadProvidersConfig();

    expect(providers?.llm?.provider).toBe("openai");
    expect(providers?.tts).toMatchObject({
      provider: "elevenlabs",
      elevenlabs: { voiceId: "EXAVITQu4vr4xnSDxMaL", model: "eleven_v4_turbo" },
    });
  });
});
