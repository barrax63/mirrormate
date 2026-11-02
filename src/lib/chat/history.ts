// Conversation history sent with each chat request. Every resent message costs tokens, so only
// the most recent part of the conversation goes to the LLM. Used by /api/chat and both pages.

/** Messages sent unless providers.llm.historyLimit says otherwise */
export const DEFAULT_HISTORY_LIMIT = 20;

/** The configured limit if it's a whole number of at least 1, and the default otherwise */
export function historyLimitFrom(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : DEFAULT_HISTORY_LIMIT;
}

/**
 * The last `limit` messages, starting at a user message, so that no reply is left without the
 * question it answered
 */
export function trimHistory<T extends { role: string }>(messages: T[], limit: number): T[] {
  const kept = messages.slice(-limit);
  const firstUser = kept.findIndex((message) => message.role === "user");
  return firstUser > 0 ? kept.slice(firstUser) : kept;
}
