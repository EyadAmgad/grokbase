/**
 * GrokBase adapter — speaks the contract of the backend that already ships in
 * this repository (src/routes/nlp.py): a project-scoped, non-streaming RAG API.
 *
 *   GET  /api/v1/                              → {app_name, app_version}
 *   POST /api/v1/nlp/index/answer/{project_id} → {text, limit}
 *       ↳ {signal: "...", answer, full_prompt, chat_history}
 *
 * Mapping decisions:
 *   - The backend has no user accounts: the workspace runs in "guest" mode;
 *     `fetchUser` doubles as a readiness ping (`GET /api/v1/`) and fails with
 *     a retryable error when the backend is unreachable.
 *   - The backend persists no chat history: `fetchHistory` resolves to an
 *     empty transcript and the UI shows the start state.
 *   - Answers arrive as one JSON payload (no SSE yet). The provider streams
 *     them in visually via mock-style chunking without changing the wire wait.
 *   - Streaming-capable backends (SSE/WebSocket) can still be used by setting
 *     VITE_STREAM_MODE — the generic `restAdapter` implements those paths.
 */

import type { AIChatConfig } from "../config";
import type { ChatMessage, ChatRequestPayload } from "../types";
import {
  AdapterError,
  type AIChatAdapter,
  type StreamHandlers,
} from "./types";
import {
  buildUrl,
  extractDelta,
  requestJson,
  streamViaFetch,
  streamViaWebSocket,
} from "./restAdapter";
import { loadSessionMessages } from "../sessions";

interface AppInfo {
  app_name?: string;
  app_version?: string;
}

/** Emit `text` in small chunks so long RAG replies render progressively. */
function emitSimulatedStream(text: string, handlers: StreamHandlers, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    let index = 0;
    let accumulated = "";
    const chunkSize = 64; // characters per visual chunk

    const step = () => {
      if (signal.aborted) {
        handlers.onError(new AdapterError("cancelled", "Generation cancelled."));
        resolve();
        return;
      }
      if (index >= text.length) {
        handlers.onDone(text);
        resolve();
        return;
      }
      const chunk = text.slice(index, index + chunkSize);
      accumulated += chunk;
      index += chunkSize;
      handlers.onDelta(chunk);
      // Yield between chunks so long answers paint progressively.
      window.setTimeout(step, 16);
    };
    step();
  });
}

export const grokbaseAdapter: AIChatAdapter = {
  async fetchUser(config, signal) {
    // Readiness ping against the real backend; profile is client-side guest.
    const info = await requestJson<AppInfo>(buildUrl(config, "/api/v1/"), config, signal);
    void info.app_name; // available to callers that want the app identity
    return {
      id: "guest",
      name: config.userName,
      email: config.userEmail,
      avatarUrl: null,
    };
  },

  // GrokBase stores no conversation history server-side; the session store
  // (lib/sessions.ts) keeps the per-project transcript client-side.
  async fetchHistory(config): Promise<ChatMessage[]> {
    return loadSessionMessages(config.projectId);
  },

  async streamCompletion(
    payload: ChatRequestPayload,
    config: AIChatConfig,
    handlers: StreamHandlers,
    signal: AbortSignal,
  ): Promise<void> {
    const limit = config.topK;

    if (config.streamMode === "websocket") {
      // {project_id} placeholder in the configured endpoint.
      const path = config.endpoints.stream.replace("{project_id}", String(config.projectId));
      await streamViaWebSocket(
        buildUrl(config, path, true),
        JSON.stringify({ text: payload.message, limit }),
        config,
        handlers,
        signal,
      );
      return;
    }

    if (config.streamMode === "sse") {
      // Real SSE from the backend: tokens stream from the generator as they
      // are produced (POST /api/v1/nlp/index/answer/stream/{project_id}).
      const path = config.endpoints.stream.replace("{project_id}", String(config.projectId));
      const response = await streamViaFetch(
        buildUrl(config, path),
        JSON.stringify({ text: payload.message, limit }),
        config,
        handlers,
        signal,
      );
      void response;
      return;
    }

    // JSON mode: one JSON answer body {signal, answer, …} from the plain route.
    const jsonPath = "/api/v1/nlp/index/answer/{project_id}".replace("{project_id}", String(config.projectId));
    const url = buildUrl(config, jsonPath);
    const body = JSON.stringify({ text: payload.message, limit });

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...config.headers,
        },
        body,
        signal,
        credentials: "include",
      });
    } catch {
      handlers.onError(
        signal.aborted
          ? new AdapterError("cancelled", "Generation cancelled.")
          : new AdapterError("network", "The server could not be reached. Check your connection."),
      );
      return;
    }

    if (!response.ok) {
      // 400 with {signal: RAG_ANSWER_ERROR} typically means "no matching chunks".
      handlers.onError(
        new AdapterError(
          "client",
          "No indexed content matched the question. Ingest a project and retry.",
          response.status,
        ),
      );
      return;
    }

    try {
      const data = (await response.json()) as unknown;
      const answer = extractDelta(data) ?? "";
      if (!answer) {
        handlers.onError(new AdapterError("server", "The backend returned an empty answer."));
        return;
      }
      await emitSimulatedStream(answer, handlers, signal);
    } catch {
      handlers.onError(new AdapterError("server", "The backend returned an unreadable response."));
    }
  },
};
