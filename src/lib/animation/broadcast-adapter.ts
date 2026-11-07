/**
 * BroadcastChannel Adapter
 *
 * Maps the messages /control sends over BroadcastChannel to state machine events.
 */

import type { AvatarEvent } from "./types";
import type { BroadcastMessage } from "../broadcast";

/**
 * Map a BroadcastChannel message to an AvatarEvent.
 * Returns null if the message doesn't map to any event.
 */
export function mapBroadcastToEvent(message: BroadcastMessage): AvatarEvent | null {
  switch (message.type) {
    // Microphone controls
    case "mic_start":
      return { type: "MIC_ACTIVATED" };

    case "mic_stop":
      return { type: "MIC_DEACTIVATED" };

    // Thinking/Processing
    case "thinking_start":
      return { type: "PROCESSING_START" };

    case "thinking_end":
      return { type: "PROCESSING_END" };

    // The rest don't map to state events
    default:
      return null;
  }
}
