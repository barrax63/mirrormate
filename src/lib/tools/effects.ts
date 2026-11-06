import { Tool, ToolDefinition } from "./types";
import { getLocale, type Locale } from "@/lib/app";

export type EffectType = "confetti" | "hearts" | "sparkles";

// Holds the effect to trigger for the current request
let pendingEffect: EffectType | null = null;

export function getPendingEffect(): EffectType | null {
  const effect = pendingEffect;
  pendingEffect = null; // Clear after retrieval
  return effect;
}

export function clearPendingEffect(): void {
  pendingEffect = null;
}

// The LLM reads these in the language of the rest of its prompt
const TEXT: Record<Locale, { description: string; effect: string; reason: string }> = {
  en: {
    description: `Shows an effect on the screen. Use it to express a feeling, such as when you're happy, celebrating or moved.
- confetti: confetti (celebrations, good news, achievements)
- hearts: hearts (affection, thanks, encouragement)
- sparkles: sparkles (surprises, discoveries, lovely things)`,
    effect: "Which effect to show",
    reason: "Why the effect is shown (for the log)",
  },
  ja: {
    description: `画面にエフェクトを表示します。嬉しいとき、お祝いのとき、感動したときなど、感情を表現したいときに使ってください。
- confetti: 紙吹雪（お祝い、嬉しいニュース、達成）
- hearts: ハート（愛情、感謝、応援）
- sparkles: キラキラ（驚き、発見、素敵なこと）`,
    effect: "表示するエフェクトの種類",
    reason: "エフェクトを表示する理由（内部ログ用）",
  },
  de: {
    description: `Zeigt einen Effekt auf dem Bildschirm. Benutze ihn, um ein Gefühl auszudrücken, etwa wenn du dich freust, etwas feierst oder gerührt bist.
- confetti: Konfetti (Feiern, gute Nachrichten, Erfolge)
- hearts: Herzen (Zuneigung, Dank, Ermutigung)
- sparkles: Glitzer (Überraschungen, Entdeckungen, schöne Dinge)`,
    effect: "Welcher Effekt gezeigt wird",
    reason: "Warum der Effekt gezeigt wird (fürs Log)",
  },
};

export const effectTool: Tool = {
  get definition(): ToolDefinition {
    const text = TEXT[getLocale()];
    return {
      name: "show_effect",
      description: text.description,
      parameters: {
        type: "object",
        properties: {
          effect: {
            type: "string",
            description: text.effect,
            enum: ["confetti", "hearts", "sparkles"],
          },
          reason: {
            type: "string",
            description: text.reason,
          },
        },
        required: ["effect"],
      },
    };
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const effect = args.effect as EffectType;
    const reason = args.reason as string | undefined;

    console.log(`[Effect] Triggering ${effect}${reason ? ` - ${reason}` : ""}`);

    pendingEffect = effect;

    return `Displaying ${effect} effect`;
  },
};
