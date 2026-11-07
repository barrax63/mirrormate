import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webSearchTool } from "./web-search";

vi.mock("../discord", () => ({
  isAutoShareEnabled: () => false,
  sendSearchResults: vi.fn(),
}));

const JAPANESE = /[぀-ヿ㐀-鿿]/;

const search = (query: string) => webSearchTool.execute({ query });

describe("web_search", () => {
  beforeEach(() => {
    vi.stubEnv("OLLAMA_API_KEY", "test-key");
    vi.stubEnv("LOCALE", "en");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [
            { title: "Crossing rules", url: "https://a.example", content: "Stop for people on the crossing." },
            { title: "Stripes", url: "https://b.example", content: "Why they're striped." },
          ],
        })
      )
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the results and a card in English, in English mode", async () => {
    const result = await search("zebra crossings");

    expect(result).toMatchObject({
      result: expect.stringMatching(/^Search results:\n\n1\. Crossing rules\n/),
      infoCard: { type: "search", title: "Search: zebra crossings", items: ["Crossing rules", "Stripes"] },
    });
    expect(JSON.stringify(result)).not.toMatch(JAPANESE);
  });

  it("returns them in Japanese, in Japanese mode", async () => {
    vi.stubEnv("LOCALE", "ja");

    expect(await search("横断歩道")).toMatchObject({
      result: expect.stringMatching(/^検索結果:\n\n1\. Crossing rules\n/),
      infoCard: { type: "search", title: "検索: 横断歩道", items: ["Crossing rules", "Stripes"] },
    });
  });

  it("returns them in German, in German mode", async () => {
    vi.stubEnv("LOCALE", "de");

    expect(await search("Zebrastreifen")).toMatchObject({
      result: expect.stringMatching(/^Suchergebnisse:\n\n1\. Crossing rules\n/),
      infoCard: { type: "search", title: "Suche: Zebrastreifen", items: ["Crossing rules", "Stripes"] },
    });
  });

  it("says in Japanese when nothing was found, or the search failed", async () => {
    vi.stubEnv("LOCALE", "ja");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ results: [] }));
    vi.mocked(fetch).mockResolvedValueOnce(new Response("down", { status: 503 }));

    expect(await search("横断歩道")).toEqual({ result: "「横断歩道」の検索結果は見つかりませんでした。" });
    expect(await search("横断歩道")).toEqual({
      result: "検索中にエラーが発生しました: Ollama Search API error: 503",
    });
  });
});
