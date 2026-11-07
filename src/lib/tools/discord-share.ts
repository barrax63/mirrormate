import { Tool, ToolDefinition, ToolExecuteResult } from "./types";
import { sendTextMessage, sendSearchResults, isDiscordEnabled } from "../discord";
import { getLastSearchResults, findSearchResultsByQuery } from "./web-search";
import { getLocale, type Locale } from "@/lib/app";

// The definition and results for the LLM, some results with what to tell the user, and the card
interface ShareText {
  description: string;
  title: string;
  content: string;
  url: string;
  includeSearchResults: string;
  notConfigured: string;
  missing: string;
  sentResults(query: string, count: number, titles: string[]): string;
  sentText(title: string): string;
  failed: string;
  error(message: string): string;
  cardTitle: string;
  sharedCount(count: number): string;
}

const TEXT: Record<Locale, ShareText> = {
  en: {
    description:
      "Share information to the user's Discord. Use this when the user wants to save or share search results, links, or important information to their phone. If sharing recent search results, URLs will be automatically included.",
    title: "Title of the shared content",
    content: "The content to share (text, summary, or information)",
    url: "Optional URL to include",
    includeSearchResults: "Set to 'true' to include recent search results with their source URLs",
    notConfigured: "Discord integration is not configured. Please set DISCORD_WEBHOOK_URL environment variable.",
    missing: "Sharing to Discord needs a title or content.",
    sentResults: (query, count, titles) =>
      `Sent to Discord! Shared ${count} links about "${query}" (${titles.join(", ")}, and more). Tell the user briefly: "Sent it! I added the links too."`,
    sentText: (title) => `Sent to Discord! Shared "${title}". Tell the user briefly: "Sent it!"`,
    failed: "Sending to Discord failed. Tell the user to check the settings.",
    error: (message) => `Discord error: ${message}`,
    cardTitle: "Sent to Discord",
    sharedCount: (count) => `${count} items shared`,
  },
  ja: {
    description:
      "ユーザーのDiscordに情報を共有します。検索結果やリンク、大事な情報をスマホに保存・共有したいとユーザーが言ったときに使ってください。直近の検索結果を共有するときは、URLが自動で含まれます。",
    title: "共有する内容のタイトル",
    content: "共有する内容（テキスト、要約、情報）",
    url: "含めるURL（任意）",
    includeSearchResults: "直近の検索結果を出典URL付きで含めるときは 'true' を指定",
    notConfigured: "Discord連携が設定されていません。環境変数 DISCORD_WEBHOOK_URL を設定してください。",
    missing: "Discord送信には title または content が必要です。",
    sentResults: (query, count, titles) =>
      `Discord送信完了！「${query}」について${count}件のリンク付きで送った（${titles.join("、")}など）。ユーザーに「送ったよ！リンクも付けておいたからね」と短く伝えて。`,
    sentText: (title) => `Discord送信完了！「${title}」の内容を送った。ユーザーに「送ったよ！」と短く伝えて。`,
    failed: "Discordへの送信に失敗した。設定を確認するよう伝えて。",
    error: (message) => `Discordエラー: ${message}`,
    cardTitle: "Discordに送信しました",
    sharedCount: (count) => `${count}件を共有`,
  },
};

export const discordShareTool: Tool = {
  get definition(): ToolDefinition {
    const text = TEXT[getLocale()];
    return {
      name: "share_to_discord",
      description: text.description,
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: text.title,
          },
          content: {
            type: "string",
            description: text.content,
          },
          url: {
            type: "string",
            description: text.url,
          },
          includeSearchResults: {
            type: "string",
            description: text.includeSearchResults,
          },
        },
        required: ["title", "content"],
      },
    };
  },

  async execute(args: Record<string, unknown>): Promise<ToolExecuteResult> {
    const title = (args.title as string) || "";
    const content = (args.content as string) || "";
    const url = args.url as string | undefined;
    const includeSearchResults = args.includeSearchResults === "true" || args.includeSearchResults === true;

    const text = TEXT[getLocale()];

    if (!isDiscordEnabled()) {
      return { result: text.notConfigured };
    }

    // Validate required parameters
    if (!title && !content) {
      return { result: text.missing };
    }

    console.log(`[Discord] Sharing, includeSearchResults: ${includeSearchResults}`);

    try {
      let success = false;
      let sharedQuery = title;
      let sharedCount = 0;

      // If including search results, send them with URLs
      if (includeSearchResults) {
        // First, try to find results matching the title (user's intent)
        let searchData = findSearchResultsByQuery(title);

        // Fall back to the most recent search results
        if (!searchData || searchData.results.length === 0) {
          const lastResults = getLastSearchResults();
          if (lastResults.results.length > 0) {
            searchData = lastResults;
          }
        }

        if (searchData && searchData.results.length > 0) {
          const { query, results } = searchData;
          success = await sendSearchResults(query, results);
          sharedQuery = query;
          sharedCount = results.length;
          if (success) {
            return {
              result: text.sentResults(query, results.length, results.slice(0, 2).map((r) => r.title)),
              infoCard: {
                type: "discord",
                title: text.cardTitle,
                items: [text.sharedCount(sharedCount), sharedQuery],
              },
            };
          }
        }
      }

      // Fall back to text message
      success = await sendTextMessage(title, content, url);

      if (success) {
        return {
          result: text.sentText(title),
          infoCard: {
            type: "discord",
            title: text.cardTitle,
            items: [title],
          },
        };
      } else {
        return { result: text.failed };
      }
    } catch (error) {
      console.error("[Discord] Share error:", error);
      return { result: text.error((error as Error).message) };
    }
  },
};
