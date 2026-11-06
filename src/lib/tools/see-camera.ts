import { Tool, ToolContext } from "./types";
import { getVLMProvider } from "@/lib/vlm";
import { getLocale, type Locale } from "@/lib/app";

// Results for the LLM, and the language the VLM describes the image in
const TEXT: Record<Locale, { noImage: string; noVlm: string; failed: string; language: string }> = {
  en: {
    noImage: "No camera image is available. The user's camera may be off.",
    noVlm: "The image analysis service isn't available.",
    failed: "Analyzing the image failed.",
    language: "English",
  },
  ja: {
    noImage: "カメラ画像が利用できません。ユーザーのカメラが有効になっていない可能性があります。",
    noVlm: "視覚分析サービスが利用できません。",
    failed: "画像の分析中にエラーが発生しました。",
    language: "Japanese",
  },
};

/**
 * Tool that allows LLM to see what the camera is showing.
 * This enables vision-based conversations when the LLM decides it needs visual context.
 */
export const seeCameraTool: Tool = {
  definition: {
    name: "see_camera",
    description:
      "IMPORTANT: Use this tool FIRST when the user asks anything about themselves visually - what they're wearing, holding, showing, how they look, what's in front of the camera, etc. This is a camera that shows YOU what the USER looks like right now. Do NOT use web_search for questions about the user's appearance. Examples: 'What am I wearing?', 'What am I holding?', 'How do I look?', 'What color is this?', 'Can you see this?', 'What clothes do I have on?'",
    parameters: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description:
            "What to focus on when analyzing the image. E.g., 'what the person is holding', 'their clothing', 'their expression', 'objects in frame'",
        },
      },
      required: [],
    },
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
