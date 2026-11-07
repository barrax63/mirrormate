import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { discordShareTool } from "./discord-share";
import { consoleOutput } from "../testing/console";

const mocks = vi.hoisted(() => ({
  isDiscordEnabled: vi.fn(),
  sendTextMessage: vi.fn(),
  sendSearchResults: vi.fn(),
  getLastSearchResults: vi.fn(),
}));

vi.mock("../discord", () => ({
  isDiscordEnabled: mocks.isDiscordEnabled,
  sendTextMessage: mocks.sendTextMessage,
  sendSearchResults: mocks.sendSearchResults,
}));

vi.mock("./web-search", () => ({
  getLastSearchResults: mocks.getLastSearchResults,
  findSearchResultsByQuery: () => null,
}));

const JAPANESE = /[぀-ヿ㐀-鿿]/;

const share = (args: Record<string, unknown>) => discordShareTool.execute(args);

describe("share_to_discord", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("LOCALE", "en");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.isDiscordEnabled.mockReturnValue(true);
    mocks.getLastSearchResults.mockReturnValue({
      query: "news",
      results: [
        { title: "First", url: "https://a.example", content: "a" },
        { title: "Second", url: "https://b.example", content: "b" },
        { title: "Third", url: "https://c.example", content: "c" },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("tells the LLM in English what it sent, in English mode", async () => {
    mocks.sendSearchResults.mockResolvedValue(true);
    mocks.sendTextMessage.mockResolvedValue(true);

    const results = await share({ title: "news", content: "c", includeSearchResults: "true" });
    const text = await share({ title: "Recipe", content: "c" });

    expect(results).toMatchObject({
      result:
        'Sent to Discord! Shared 3 links about "news" (First, Second, and more). Tell the user briefly: "Sent it! I added the links too."',
    });
    expect(text).toMatchObject({ result: 'Sent to Discord! Shared "Recipe". Tell the user briefly: "Sent it!"' });
  });

  it("doesn't log what it shares", async () => {
    mocks.sendTextMessage.mockResolvedValue(true);

    await share({ title: "Birthday plans", content: "Surprise party for Kim on Friday" });

    expect(consoleOutput()).toContain("[Discord] Sharing");
    expect(consoleOutput()).not.toMatch(/Birthday|Surprise|Kim/);
  });

  it("reports what went wrong in English, in English mode", async () => {
    const missing = await share({});
    mocks.sendTextMessage.mockResolvedValue(false);
    const failed = await share({ title: "Recipe", content: "c" });
    mocks.sendTextMessage.mockRejectedValue(new Error("timeout"));
    const error = await share({ title: "Recipe", content: "c" });

    for (const result of [missing, failed, error]) {
      expect(JSON.stringify(result)).not.toMatch(JAPANESE);
    }
    expect(error).toMatchObject({ result: "Discord error: timeout" });
  });

  it("titles its cards in the locale's language", async () => {
    mocks.sendSearchResults.mockResolvedValue(true);
    mocks.sendTextMessage.mockResolvedValue(true);

    expect(await share({ title: "news", content: "c", includeSearchResults: "true" })).toMatchObject({
      infoCard: { type: "discord", title: "Sent to Discord", items: ["3 items shared", "news"] },
    });
    vi.stubEnv("LOCALE", "ja");
    expect(await share({ title: "news", content: "c", includeSearchResults: "true" })).toMatchObject({
      infoCard: { type: "discord", title: "Discordに送信しました", items: ["3件を共有", "news"] },
    });
    expect(await share({ title: "レシピ", content: "c" })).toMatchObject({
      infoCard: { type: "discord", title: "Discordに送信しました", items: ["レシピ"] },
    });
  });

  it("says Discord isn't set up in the locale's language", async () => {
    mocks.isDiscordEnabled.mockReturnValue(false);
    vi.stubEnv("LOCALE", "ja");

    expect(await share({ title: "news", content: "c" })).toMatchObject({
      result: "Discord連携が設定されていません。環境変数 DISCORD_WEBHOOK_URL を設定してください。",
    });
  });

  it("tells the LLM in Japanese, in Japanese mode", async () => {
    vi.stubEnv("LOCALE", "ja");
    mocks.sendSearchResults.mockResolvedValue(true);

    expect(await share({ title: "news", content: "c", includeSearchResults: "true" })).toMatchObject({
      result:
        "Discord送信完了！「news」について3件のリンク付きで送った（First、Secondなど）。ユーザーに「送ったよ！リンクも付けておいたからね」と短く伝えて。",
    });
  });
});
