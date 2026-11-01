/**
 * Adapter contract — the only seam between the UI and a backend.
 *
 * Implement this and pass it to `<AIChatProvider adapter={…} />` to wire the
 * workspace to any API: OpenAI-compatible gateways, GrokBase RAG endpoints,
 * an SSE proxy, a WebSocket relay, or a fully mocked service in tests.
 */

import type { AIChatConfig } from "../config";
import type { ChatRequestPayload, ChatMessage, UserProfile } from "../types";

/** Callbacks used while assembling a streamed assistant answer. */
export interface StreamHandlers {
  /** Called 0..n times with incremental text (word, token, or SSE `data:` chunk). */
  onDelta(chunk: string): void;
  /** Called exactly once after successful completion with the full transcript. */
  onDone(fullText: string): void;
  /** Called at most once if the stream fails mid-flight. */
  onError(error: Error): void;
}

export interface AIChatAdapter {
  /** Resolve the signed-in user shown in the sidebar + welcome state. */
  fetchUser(config: AIChatConfig, signal: AbortSignal): Promise<UserProfile>;

  /** Load prior conversation turns (oldest → newest). */
  fetchHistory(config: AIChatConfig, signal: AbortSignal): Promise<ChatMessage[]>;

  /**
   * Begin an assistant answer. May stream via `handlers.onDelta` zero or more
   * times before `onDone`/`onError`. Implementations must honor `signal`
   * cancellation and settle exactly one of `onDone` or `onError` per call.
   */
  streamCompletion(
    payload: ChatRequestPayload,
    config: AIChatConfig,
    handlers: StreamHandlers,
    signal: AbortSignal,
  ): Promise<void>;
}

/** Error classification surfaced by adapters for consistent failure states. */
export class AdapterError extends Error {
  readonly kind: "network" | "auth" | "server" | "client" | "cancelled" | "unknown";
  readonly status?: number;

  constructor(kind: AdapterError["kind"], message: string, status?: number) {
    super(message);
    this.name = "AdapterError";
    this.kind = kind;
    this.status = status;
  }
}

/** Helper shared by HTTP-based adapters to classify fetch responses. */
export function classifyResponseError(status: number, fallback: string): AdapterError {
  if (status === 401 || status === 403) {
    return new AdapterError("auth", "Your session expired. Please sign in again.", status);
  }
  if (status >= 500) {
    return new AdapterError("server", "The AI service is temporarily unavailable.", status);
  }
  return new AdapterError("client", fallback || `Request failed (${status}).`, status);
}
