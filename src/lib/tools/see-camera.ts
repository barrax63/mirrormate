import { Tool, ToolContext, ToolDefinition } from "./types";
import { getVLMProvider } from "@/lib/vlm";
import { getLocale, type Locale } from "@/lib/app";

// The definition and results for the LLM, and the language the VLM describes the image in
interface CameraText {
  description: string;
  focus: string;
  noImage: string;
  noVlm: string;
  failed: string;
  language: string;
}

const TEXT: Record<Locale, CameraText> = {
  en: {
    description:
      "IMPORTANT: Use this tool FIRST when the user asks anything about themselves visually - what they're wearing, holding, showing, how they look, what's in front of the camera, etc. This is a camera that shows YOU what the USER looks like right now. Do NOT use web_search for questions about the user's appearance. Examples: 'What am I wearing?', 'What am I holding?', 'How do I look?', 'What color is this?', 'Can you see this?', 'What clothes do I have on?'",
    focus:
      "What to focus on when analyzing the image. E.g., 'what the person is holding', 'their clothing', 'their expression', 'objects in frame'",
    noImage: "No camera image is available. The user's camera may be off.",
    noVlm: "The image analysis service isn't available.",
    failed: "Analyzing the image failed.",
    language: "English",
  },
  ja: {
    description:
      "重要: ユーザーが自分の見た目について何か聞いたら、まずこのツールを使ってください。着ているもの、持っているもの、見せているもの、どう見えるか、カメラの前に何があるか、などです。今のユーザーの姿をあなたに見せるカメラです。ユーザーの見た目についての質問に web_search は使わないでください。例:「何着てる？」「何持ってる？」「どう見える？」「これ何色？」「これ見える？」「今どんな服着てる？」",
    focus: "画像を分析するときに注目すること。例:「持っているもの」「服装」「表情」「写っている物」",
    noImage: "カメラ画像が利用できません。ユーザーのカメラが有効になっていない可能性があります。",
    noVlm: "視覚分析サービスが利用できません。",
    failed: "画像の分析中にエラーが発生しました。",
    language: "Japanese",
  },
  de: {
    noImage: "Kein Kamerabild verfügbar. Die Kamera der Person ist vielleicht aus.",
    noVlm: "Der Dienst zur Bildanalyse ist nicht verfügbar.",
    failed: "Die Analyse des Bildes ist fehlgeschlagen.",
    language: "German",
  },
};

/**
 * Tool that allows LLM to see what the camera is showing.
 * This enables vision-based conversations when the LLM decides it needs visual context.
 */
export const seeCameraTool: Tool = {
  get definition(): ToolDefinition {
    const text = TEXT[getLocale()];
    return {
      name: "see_camera",
      description: text.description,
      parameters: {
        type: "object",
        properties: {
          focus: {
            type: "string",
            description: text.focus,
          },
        },
        required: [],
      },
    };
  },

  async execute(
    args: Record<string, unknown>,
    context?: ToolContext
  ): Promise<string> {
    const text = TEXT[getLocale()];

    // Check if image is available
    if (!context?.image) {
      return text.noImage;
    }

    // Get VLM provider
    const vlmProvider = getVLMProvider();
    if (!vlmProvider) {
      return text.noVlm;
    }

    try {
      const focus = (args.focus as string) || "the scene";

      const prompt = `Describe what you see in this webcam image. Focus on: ${focus}

Provide a concise description in 2-3 sentences in ${text.language}. Be specific about:
- What the person is doing or showing
- What they are holding or wearing (if relevant)
- Any notable details that help answer their question`;

      const result = await vlmProvider.analyzeImage(context.image, prompt);
      return result;
    } catch (error) {
      console.error("[see_camera] VLM analysis failed:", error);
      return text.failed;
    }
  },
};
