/**
 * REST + SSE (and WebSocket / plain-JSON) adapter.
 *
 * Endpoint contract — all optional-friendly, all overridable via config:
 *   GET  {base}{endpoints.user}     → UserProfile | { user: UserProfile }
 *   GET  {base}{endpoints.history}  → ChatMessage[] | { messages: ChatMessage[] }
 *   POST {base}{endpoints.stream}   → chunks (SSE / WS / JSON — see streamMode)
 *
 * The stream is intentionally tolerant of common wire formats:
 *   - SSE text streams: `data: {json}` lines, OpenAI-style `[DONE]` sentinel
 *   - WebSocket frames: JSON text frames `{delta|content|token|text}` or raw text
 *   - JSON mode: one-shot `{content|answer|text|message}` response
 */

import type { AIChatConfig } from "../config";
import type {
  ChatMessage,
  MessageStatus,
  MessageSender,
  UserProfile,
} from "../types";
import {
  AdapterError,
  classifyResponseError,
  type AIChatAdapter,
  type StreamHandlers,
} from "./types";

function buildUrl(config: AIChatConfig, path: string, socket = false): string {
  const { apiBaseUrl } = config;
  const origin = apiBaseUrl.replace(/\/$/, "");
  const url = `${origin}${path.startsWith("/") ? path : `/${path}`}`;
  if (socket) {
    const protocol = url.startsWith("https:") || url.startsWith("wss:") ? "wss" : "ws";
    return url.replace(/^https?:|^wss?:/, protocol);
  }
  return url;
}

const JSON_DELTA_KEYS = ["delta", "content", "token", "text", "answer"] as const;

function extractDelta(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    for (const key of JSON_DELTA_KEYS) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === "string") return value;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested = extractDelta(value);
        if (nested !== null) return nested;
      }
    }
  }
  return null;
}

export async function requestJson<T>(url: string, config: AIChatConfig, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", ...config.headers },
      signal,
      credentials: "include",
    });
  } catch (error) {
    if (signal.aborted) throw new AdapterError("cancelled", "Request cancelled.");
    throw new AdapterError("network", "The server could not be reached. Check your connection.");
  }
  if (!response.ok) throw classifyResponseError(response.status, "Request failed.");
  try {
    return (await response.json()) as T;
  } catch {
    throw new AdapterError("server", "The server returned an unreadable response.");
  }
}

/* ------------------------------- SSE parser ------------------------------ */

/**
 * Reads an SSE body, buffering partial lines (chunks may split a `data:` line
 * mid-flight), forwarding every delta, and resolving with the full transcript.
 */
async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
): Promise<string> {
  let full = "";
  let buffer = "";
  const decoder = new TextDecoder();
  const reader = stream.getReader();

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    // stream:true keeps multi-byte characters valid across chunk boundaries
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]" || data === "[END]") continue;
      let delta = data;
      if (data.startsWith("{") || data.startsWith("[")) {
        try {
          delta = extractDelta(JSON.parse(data)) ?? "";
        } catch {
          /* leave raw text as the delta */
        }
      }
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
  }
  if (buffer.trim().startsWith("data:")) {
    const data = buffer.trim().slice(5).trim();
    if (data && data !== "[DONE]" && data !== "[END]") {
      full += data;
      onDelta(data);
    }
  }
  return full;
}

/* --------------------------------- adapter -------------------------------- */

export const restAdapter: AIChatAdapter = {
  async fetchUser(config, signal) {
    const data = await requestJson<Partial<UserProfile> & { user?: UserProfile }>(
      buildUrl(config, config.endpoints.user),
      config,
      signal,
    );
    const profile = (data.user ?? data) as UserProfile;
    if (!profile?.id || !profile?.name) {
      throw new AdapterError("client", "The user profile response was malformed.");
    }
    return profile;
  },

  async fetchHistory(config, signal) {
    const data = await requestJson<
      ChatMessage[] | { messages?: unknown[]; data?: unknown[] }
    >(buildUrl(config, config.endpoints.history), config, signal);
    const rows = Array.isArray(data) ? data : (data.data ?? data.messages ?? []);
    if (!Array.isArray(rows)) return [];
    return rows.map(normalizeHistoryRow).filter((row): row is ChatMessage => row !== null);
  },

  async streamCompletion(payload, config, handlers, signal) {
    const body = JSON.stringify({
      message: payload.message,
      history: payload.history.slice(-config.historyLimit).map((message) => ({
        sender: message.sender,
        content: message.content,
      })),
      model: config.model,
      temperature: config.temperature,
      max_tokens: payload.maxTokens ?? config.maxTokens,
      stream: config.streamMode !== "json",
    });

    if (config.streamMode === "websocket") {
      await streamViaWebSocket(buildUrl(config, config.endpoints.stream, true), body, config, handlers, signal);
      return;
    }

    await streamViaFetch(buildUrl(config, config.endpoints.stream), body, config, handlers, signal);
  },
};

/* ------------------------- exports reused by other adapters ---------------- */

export { buildUrl, extractDelta, readSseStream, streamViaFetch, streamViaWebSocket };

async function streamViaFetch(
  url: string,
  body: string,
  config: AIChatConfig,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: config.streamMode === "json" ? "application/json" : "text/event-stream",
        ...config.headers,
      },
      body,
      signal,
      credentials: "include",
    });
  } catch (error) {
    const message = signal.aborted
      ? undefined
      : "The server could not be reached. Check your connection.";
    handlers.onError(
      message
        ? new AdapterError("network", message)
        : new AdapterError("cancelled", "Generation cancelled."),
    );
    return;
  }

  if (!response.ok) {
    handlers.onError(classifyResponseError(response.status, "The AI service rejected the request."));
    return;
  }

  try {
    if (config.streamMode === "json") {
      const data = (await response.json()) as unknown;
      const text = extractDelta(data) ?? "";
      if (text) handlers.onDelta(text);
      handlers.onDone(text);
      return;
    }

    if (!response.body) {
      handlers.onDone("");
      return;
    }

    let full = "";
    await readSseStream(response.body, handlers.onDelta).then((text) => {
      full = text;
    });
    handlers.onDone(full);
  } catch (error) {
    if (signal.aborted) {
      handlers.onError(new AdapterError("cancelled", "Generation cancelled."));
      return;
    }
    const detail = error instanceof SyntaxError ? "interrupted mid-stream" : error;
    handlers.onError(new AdapterError("unknown", `The stream ended unexpectedly (${detail}).`));
  }
}

async function streamViaWebSocket(
  url: string,
  body: string,
  _config: AIChatConfig,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      handlers.onError(new AdapterError("network", "Could not open the chat socket."));
      resolve();
      return;
    }

    let full = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (error) handlers.onError(error);
      else handlers.onDone(full);
      window.clearTimeout(timeout);
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      resolve();
    };

    const timeout = window.setTimeout(() => {
      finish(new AdapterError("network", "The chat socket timed out."));
    }, 45_000);

    signal.addEventListener("abort", () => finish(new AdapterError("cancelled", "Generation cancelled.")), {
      once: true,
    });

    ws.addEventListener("open", () => ws.send(body));
    ws.addEventListener("message", (event) => {
      const raw =
        typeof event.data === "string" ? event.data : String(event.data ?? "");
      if (raw === "[DONE]" || raw === "[END]") {
        finish();
        return;
      }
      const delta = extractDelta(raw.startsWith("{") || raw.startsWith("[") ? JSON.parse(raw) : raw);
      if (delta) {
        full += delta;
        handlers.onDelta(delta);
      }
    });
    ws.addEventListener("error", () => {
      if (!settled) finish(new AdapterError("network", "The chat socket failed mid-stream."));
    });
    ws.addEventListener("close", () => finish());
  });
}

/* ------------------------- history row normalization ----------------------- */

interface RowLike {
  id?: unknown;
  sender?: unknown;
  role?: unknown;
  content?: unknown;
  text?: unknown;
  timestamp?: unknown;
  created_at?: unknown;
  status?: unknown;
}

function normalizeHistoryRow(row: unknown): ChatMessage | null {
  if (!row || typeof row !== "object") return null;
  const at = row as RowLike;
  const content = typeof at.content === "string" ? at.content : typeof at.text === "string" ? at.text : null;
  if (!content) return null;
  const rawSender = (at.sender ?? at.role) as string | undefined;
  const sender: MessageSender =
    rawSender === "user" || rawSender === "system"
      ? rawSender
      : rawSender === "assistant" || rawSender === "ai" || rawSender === "bot"
        ? "assistant"
        : "user";
  const rawTime = at.timestamp ?? at.created_at;
  const timestamp =
    typeof rawTime === "number" ? rawTime : typeof rawTime === "string" ? Date.parse(rawTime) || Date.now() : Date.now();
  const status: MessageStatus = at.status === "error" ? "error" : "complete";
  return {
    id: typeof at.id === "string" || typeof at.id === "number" ? String(at.id) : `history-${Math.random().toString(36).slice(2)}`,
    sender,
    content,
    timestamp,
    status,
  };
}
