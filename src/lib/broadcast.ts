/**
 * Every message that the avatar page, /control, the hooks they share and the vision-companion
 * plugin send each other over BroadcastChannel("mirror-channel"), so they must run in the same
 * browser. A new message type goes here, and senders check theirs with `satisfies BroadcastMessage`.
 */
export interface BroadcastMessage {
  type:
    // /control's chat, which the avatar page shows and speaks
    | "user_message"
    | "thinking_start"
    | "thinking_end"
    | "response"
    // JSON { text, voice }, or the text
    | "play_audio"
    // JSON: the cards tools returned with the reply
    | "info_cards"
    | "effect"
    // The mic, switched from /control, and its status from the avatar page ("off", "listening"
    // or "paused")
    | "mic_start"
    | "mic_stop"
    | "mic_status"
    | "mic_request_status"
    // JSON: the voice or character picked on /control
    | "settings_changed"
    // "on" or "off", handled by useVisionEnabled
    | "vision_toggle"
    // A camera frame for chat from the vision-companion plugin: a data URL, or null without one
    | "camera_capture_request"
    | "camera_capture_response"
    // A failed or recovered route, and a request for the current ones, handled by useServiceErrors
    | "service_error"
    | "service_errors_request";
  payload?: string | null;
}
