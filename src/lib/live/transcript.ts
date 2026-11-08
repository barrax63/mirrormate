import type { LiveMessage, LiveRole } from "./types";

/**
 * The conversation from GPT-Live's transcript deltas, which mark no turns: deltas from the same
 * side in a row make one turn. Both sides can speak at once, so a turn can be split where the
 * other side spoke over it.
 */
export class LiveTranscript {
  private turns: LiveMessage[] = [];

  /** Adds a delta, and returns the text of the turn it belongs to so far */
  add(role: LiveRole, delta: string): string {
    const last = this.turns.at(-1);
    if (last && last.role === role) {
      last.content += delta;
    } else {
      this.turns.push({ role, content: delta });
    }
    return this.turns.at(-1)!.content.trim();
  }

  /** The turns with text, oldest first */
  messages(): LiveMessage[] {
    return this.turns
      .map((turn) => ({ role: turn.role, content: turn.content.trim() }))
      .filter((turn) => turn.content.length > 0);
  }
}
