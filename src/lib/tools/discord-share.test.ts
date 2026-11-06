import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { discordShareTool } from "./discord-share";

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

  it("tells the LLM in Japanese, in Japanese mode", async () => {
    vi.stubEnv("LOCALE", "ja");
    mocks.sendSearchResults.mockResolvedValue(true);

    expect(await share({ title: "news", content: "c", includeSearchResults: "true" })).toMatchObject({
      result:
        "Discord送信完了！「news」について3件のリンク付きで送った（First、Secondなど）。ユーザーに「送ったよ！リンクも付けておいたからね」と短く伝えて。",
    });
  });
});
