import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearProvidersConfigCache } from "./config-loader";
import { clearSTTProviderCache, getSTTClientConfig, getSTTProvider } from "./stt";
import { clearPresetCache } from "../presets";

describe("STT providers", () => {
  let tempDirs: string[];

  beforeEach(() => {
    tempDirs = [];
    clearProvidersConfigCache();
    clearSTTProviderCache();
    clearPresetCache();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  });

  // Makes the loader read this stt section from a temporary config/ directory
  function useSttConfig(stt: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirrormate-stt-"));
    tempDirs.push(dir);
    fs.mkdirSync(path.join(dir, "config"));
    fs.writeFileSync(path.join(dir, "config", "providers.yaml"), `providers:\n  stt:\n${stt}`);
    vi.spyOn(process, "cwd").mockReturnValue(dir);
  }

  describe("getSTTProvider", () => {
    it("sends wake word audio to local Whisper, and speech to stt.provider", () => {
      useSttConfig(`    enabled: true
    provider: openai
    wakeWord:
      provider: local
`);

      expect(getSTTProvider("wakeWord")?.getProviderName()).toBe("local-whisper");
      expect(getSTTProvider("speech")?.getProviderName()).toBe("openai-whisper");
    });

    it("uses local Whisper for the wake word when stt.wakeWord is missing", () => {
      useSttConfig(`    enabled: true
    provider: openai
`);

      expect(getSTTProvider("wakeWord")?.getProviderName()).toBe("local-whisper");
    });

    it("refuses a cloud provider for the wake word", () => {
      useSttConfig(`    enabled: true
    provider: openai
    wakeWord:
      provider: openai
`);

      expect(getSTTProvider("wakeWord")).toBeNull();
      expect(getSTTProvider("speech")?.getProviderName()).toBe("openai-whisper");
    });

    it("keeps one provider for each purpose", () => {
      useSttConfig(`    enabled: true
    provider: local
`);

      const wakeWord = getSTTProvider("wakeWord");

      expect(getSTTProvider("wakeWord")).toBe(wakeWord);
      expect(getSTTProvider("speech")).not.toBe(wakeWord);
    });

    it("has neither while STT is disabled", () => {
      useSttConfig(`    enabled: false
    provider: openai
`);

      expect(getSTTProvider("wakeWord")).toBeNull();
      expect(getSTTProvider("speech")).toBeNull();
    });
  });

  describe("getSTTClientConfig", () => {
    it("passes on how wake word recordings are cut", () => {
      useSttConfig(`    enabled: true
    provider: openai
    wakeWord:
      maxRecordingDuration: 8000
      overlap: 2000
`);

      expect(getSTTClientConfig().wakeWord).toEqual({ maxRecordingDuration: 8000, overlap: 2000 });
    });

    it("cuts after 10 s with 3 s of overlap by default", () => {
      useSttConfig(`    enabled: true
    provider: openai
`);

      expect(getSTTClientConfig().wakeWord).toEqual({ maxRecordingDuration: 10000, overlap: 3000 });
    });

    it("replaces values that aren't positive durations with the defaults", () => {
      useSttConfig(`    enabled: true
    provider: openai
    wakeWord:
      maxRecordingDuration: -5
      overlap: "a lot"
`);

      expect(getSTTClientConfig().wakeWord).toEqual({ maxRecordingDuration: 10000, overlap: 3000 });
    });

    it("overlaps by half a recording when the overlap is as long as the recordings", () => {
      useSttConfig(`    enabled: true
    provider: openai
    wakeWord:
      maxRecordingDuration: 2000
`);

      expect(getSTTClientConfig().wakeWord).toEqual({ maxRecordingDuration: 2000, overlap: 1000 });
    });
  });
});
