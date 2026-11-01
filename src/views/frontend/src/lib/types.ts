/**
 * Domain model for the AI Chat Workspace.
 *
 * Nothing here is tied to a specific backend shape; adapters normalize their
 * wire format (REST, SSE, WebSocket…) into these primitives so components
 * never import transport or API details.
 */

/** Author of a chat message. */
export type MessageSender = "user" | "assistant" | "system";

/**
 * Lifecycle of a message:
 * - `sending`  — request dispatched, no stream activity yet
 * - `streaming`— partial content is arriving (SSE chunk / WebSocket frame)
 * - `complete` — finalized successfully
 * - `error`    — failed; retained so the user can retry inline
 */
export type MessageStatus = "sending" | "streaming" | "complete" | "error";

/** Signed-in user, rendered in the sidebar profile card and the welcome copy. */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  /** Optional: adapters that cannot resolve an avatar fall back to initials. */
  avatarUrl?: string | null;
}

/** Actionable prompt shortcut rendered in the 2×3 start-state grid. */
export interface PromptCard {
  id: string;
  title: string;
  description: string;
  /** Serializable key resolved to a `lucide-react` icon by the UI registry. */
  icon: PromptIconKey;
  /** Prompt text this card populates/sends into the composer. */
  presetPrompt: string;
}

/** Icon registry keys available to prompt cards. */
export type PromptIconKey =
  | "pen"
  | "image"
  | "search"
  | "article"
  | "chart"
  | "code";

export interface FolderSummary {
  id: string;
  name: string;
  /** Number of conversations/items inside the folder. */
  count: number;
}

/** A single transcript entry. Timestamps are epoch ms for wire-friendliness. */
export interface ChatMessage {
  id: string;
  sender: MessageSender;
  content: string;
  timestamp: number;
  status: MessageStatus;
}

/** Staged file selected in the composer before send. */
export interface ComposerAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
}

/** Payload handed to the adapter for each turn. */
export interface ChatRequestPayload {
  message: string;
  /** Prior turns (oldest → newest) so the backend has conversational context. */
  history: ChatMessage[];
  /** Staged files selected in the composer (adapters may upload/ignore). */
  attachments?: ComposerAttachment[];
  /** Model parameters resolved from config, overridable per request. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/** Loading/error lifecycle shared by every async slice of state. */
export type RequestState = "idle" | "loading" | "ready" | "error";

/** Attachment staged on the composer before send. */
export interface ComposerAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
}
