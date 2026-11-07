import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as yaml from "js-yaml";
import { describe, it, expect, vi, afterEach } from "vitest";
import { LOCALES, clearAppConfigCache, getLocale } from "./index";

const CONFIG = path.join(process.cwd(), "config");

function load(...parts: string[]): Record<string, unknown> {
  return yaml.load(fs.readFileSync(path.join(CONFIG, ...parts), "utf8")) as Record<string, unknown>;
}

const files = (locale: string) => fs.readdirSync(path.join(CONFIG, "locales", locale)).sort();

/** The committed config, which every locale fills in the same way */
describe.each(LOCALES)("config for %s", (locale) => {
  it("has the same files as English, and a preset", () => {
    expect(files(locale)).toEqual(files("en"));
    expect(fs.existsSync(path.join(CONFIG, "presets", `${locale}.yaml`))).toBe(true);
  });

  it("has the same rules, modules and characters as English", () => {
    const ids = (locale: string) => ({
      rules: Object.keys(load("locales", locale, "rules.yaml").rules as object),
      modules: Object.keys(load("locales", locale, "modules.yaml").modules as object),
      characters: (load("locales", locale, "characters.yaml").characters as { id: string }[]).map((c) => c.id),
    });

    expect(ids(locale)).toEqual(ids("en"));
  });

  it("gives the preset a voice", () => {
    const { tts } = load("presets", `${locale}.yaml`) as { tts?: { voiceId?: string } };

    expect(tts?.voiceId).toMatch(/^\w{20}$/);
  });

  it("gives the character a wake phrase and a fallback line", () => {
    const { character } = load("locales", locale, "character.yaml") as {
      character: { wakeWord?: { phrase?: string }; fallbackReply?: string };
    };

    expect(character.wakeWord?.phrase).toBeTruthy();
    expect(character.fallbackReply).toBeTruthy();
  });

  it("has the same memory labels as English", () => {
    const labels = (locale: string) =>
      Object.keys((load("locales", locale, "memory.yaml").memory as { extraction: { labels: object } }).extraction.labels);

    expect(labels(locale)).toEqual(labels("en"));
  });
});

describe("getLocale", () => {
  const dirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    clearAppConfigCache();
    dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  });

  function useAppYaml(locale: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirrormate-app-"));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, "config"));
    fs.writeFileSync(path.join(dir, "config", "app.yaml"), `app:\n  locale: "${locale}"\n`);
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    clearAppConfigCache();
  }

  it.each(LOCALES)("takes %s from LOCALE", (locale) => {
    vi.stubEnv("LOCALE", locale);

    expect(getLocale()).toBe(locale);
  });

  it("uses config/app.yaml when LOCALE is blank or unknown", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    useAppYaml("de");

    vi.stubEnv("LOCALE", "");
    expect(getLocale()).toBe("de");
    vi.stubEnv("LOCALE", "fr");
    expect(getLocale()).toBe("de");
  });

  it("falls back to ja for an unknown app.locale, as without the file", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("LOCALE", "");
    useAppYaml("DE");

    expect(getLocale()).toBe("ja");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown app.locale "DE"'));
  });
});
