import { WavingResult } from "./types";

export const WAVING_PROMPT = `Analyze this webcam image. Is the person waving or raising their hand to greet?

A "wave" includes:
- Hand raised with palm facing camera
- Hand moving side to side
- Any greeting gesture with raised hand
- Peace sign or similar hand gesture

Answer in JSON format:
{"waving": true, "confidence": 0.8, "reason": "hand is raised"}

If you see a raised hand or waving motion, set waving to true.
JSON:`;

/**
 * Reads a VLM's answer to WAVING_PROMPT, which is usually JSON but not always
 */
export function parseWavingResponse(response: string): WavingResult {
  // Try to parse JSON from response - look for the last complete JSON object
  const jsonMatches = response.match(/\{[^{}]*\}/g);
  if (jsonMatches && jsonMatches.length > 0) {
    // Try each match, starting from the last one
    for (let i = jsonMatches.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(jsonMatches[i]);
        // Check for waving or looking key (llava might use either)
        const isWaving = Boolean(parsed.waving ?? parsed.looking ?? parsed.wave);
        return {
          waving: isWaving,
          confidence: Number(parsed.confidence) || (isWaving ? 0.8 : 0.2),
          reason: String(parsed.reason || parsed.description || ""),
          rawResponse: response,
        };
      } catch {
        continue;
      }
    }
  }

  // Fallback: Check for yes/no or waving keywords in text response
  const lowerResponse = response.toLowerCase();
  const positiveKeywords = ["yes", "waving", "raised hand", "greeting", "wave", "raising"];
  const negativeKeywords = ["no", "not waving", "no wave", "not raising"];

  const hasPositive = positiveKeywords.some(kw => lowerResponse.includes(kw));
  const hasNegative = negativeKeywords.some(kw => lowerResponse.includes(kw));

  if (hasPositive && !hasNegative) {
    return {
      waving: true,
      confidence: 0.6,
      reason: "Detected from text response",
      rawResponse: response,
    };
  }

  console.warn(`[VLM] Could not parse the response of ${response.length} characters`);
  return {
    waving: false,
    confidence: 0,
    reason: "Could not parse response",
    rawResponse: response
  };
}
