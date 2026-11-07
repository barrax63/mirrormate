import { Tool, ToolExecuteResult } from "./types";
import { sendTextMessage, sendSearchResults, isDiscordEnabled } from "../discord";
import { getLastSearchResults, findSearchResultsByQuery } from "./web-search";
import { getLocale, type Locale } from "@/lib/app";

// Results for the LLM, some with what to tell the user
interface ShareText {
  missing: string;
  sentResults(query: string, count: number, titles: string[]): string;
  sentText(title: string): string;
  failed: string;
  error(message: string): string;
}

const TEXT: Record<Locale, ShareText> = {
  en: {
    missing: "Sharing to Discord needs a title or content.",
    sentResults: (query, count, titles) =>
      `Sent to Discord! Shared ${count} links about "${query}" (${titles.join(", ")}, and more). Tell the user briefly: "Sent it! I added the links too."`,
    sentText: (title) => `Sent to Discord! Shared "${title}". Tell the user briefly: "Sent it!"`,
    failed: "Sending to Discord failed. Tell the user to check the settings.",
    error: (message) => `Discord error: ${message}`,
  },
  ja: {
    missing: "Discord送信には title または content が必要です。",
    sentResults: (query, count, titles) =>
      `Discord送信完了！「${query}」について${count}件のリンク付きで送った（${titles.join("、")}など）。ユーザーに「送ったよ！リンクも付けておいたからね」と短く伝えて。`,
    sentText: (title) => `Discord送信完了！「${title}」の内容を送った。ユーザーに「送ったよ！」と短く伝えて。`,
    failed: "Discordへの送信に失敗した。設定を確認するよう伝えて。",
    error: (message) => `Discordエラー: ${message}`,
  },
  de: {
    missing: "Für Discord braucht es einen Titel oder einen Inhalt.",
    sentResults: (query, count, titles) =>
      `An Discord gesendet! ${count} Links zu „${query}“ geteilt (${titles.join(", ")} und mehr). Sag der Person kurz: „Gesendet! Die Links sind auch dabei.“`,
    sentText: (title) => `An Discord gesendet! „${title}“ geteilt. Sag der Person kurz: „Gesendet!“`,
    failed: "Senden an Discord fehlgeschlagen. Sag der Person, sie soll die Einstellungen prüfen.",
    error: (message) => `Discord-Fehler: ${message}`,
  },
};

export const discordShareTool: Tool = {
  definition: {
    name: "share_to_discord",
    description:
      "Share information to the user's Discord. Use this when the user wants to save or share search results, links, or important information to their phone. If sharing recent search results, URLs will be automatically included.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the shared content",
        },
        content: {
          type: "string",
          description: "The content to share (text, summary, or information)",
        },
        url: {
          type: "string",
          description: "Optional URL to include",
        },
        includeSearchResults: {
          type: "string",
          description: "Set to 'true' to include recent search results with their source URLs",
        },
      },
      required: ["title", "content"],
    },
  },

  async execute(args: Record<string, unknown>): Promise<ToolExecuteResult> {
    const title = (args.title as string) || "";
    const content = (args.content as string) || "";
    const url = args.url as string | undefined;
    const includeSearchResults = args.includeSearchResults === "true" || args.includeSearchResults === true;

    const text = TEXT[getLocale()];

    if (!isDiscordEnabled()) {
      return { result: "Discord integration is not configured. Please set DISCORD_WEBHOOK_URL environment variable." };
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
                title: "Sent to Discord",
                items: [`${sharedCount} items shared`, sharedQuery],
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
            title: "Sent to Discord",
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
