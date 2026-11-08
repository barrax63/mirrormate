// Shared by the server and the avatar page, so nothing here may read the config

/** What the avatar page needs to know about live mode, from GET /api/live */
export interface LiveClientConfig {
  enabled: boolean;
  /** Seconds without speech, heard or said, before the page closes the session */
  idleTimeout: number;
  /** Seconds a session may last at most */
  maxDuration: number;
}

export type LiveRole = "user" | "assistant";

export interface LiveMessage {
  role: LiveRole;
  content: string;
}
