/**
 * Runtime configuration for the chat workspace.
 *
 * Every value can come from one of two sources (lowest → highest priority):
 *   1. The build environment — `VITE_API_URL`, `VITE_MODEL`, etc. (Vite).
 *      Under Next.js the identical keys are inlined as `NEXT_PUBLIC_*`,
 *      so `apiUrl` may arrive via `NEXT_PUBLIC_API_URL`.
 *   2. `<AIChatProvider config={{ ... }} />` props, for embedding the
 *      workspace in an app that owns its own environment/config source.
 *
 * Components never read env vars directly; they only see a resolved config.
 */

export type AdapterMode = "mock" | "rest";
export type StreamMode = "sse" | "websocket" | "json";

export interface AIChatConfig {
  /** `"mock"` runs a fully offline simulated backend; `"rest"` talks to a server. */
  mode: AdapterMode;
  /** `"sse"` (server-sent events), `"websocket"`, or `"json"` (single response). */
  streamMode: StreamMode;
  /** Base API URL — leave empty for same-origin, path-relative requests (`/api/...`). */
  apiBaseUrl: string;
  /** Model parameters forwarded verbatim to the backend. */
  model: string;
  temperature: number;
  maxTokens: number;
  /** Applied to every request (e.g. `Authorization: Bearer …`). */
  headers: Record<string, string>;
  /** How many prior turns accompany each request as context. */
  historyLimit: number;

  /* GrokBase contract (src/routes/nlp.py): project-scoped RAG over an index. */
  /** Numeric project id for `/api/v1/nlp/index/answer/{project_id}`. */
  projectId: number;
  /** Retrieval `limit` — number of matching chunks sent to the generator. */
  topK: number;
  /** Guest identity (the backend has no account system). */
  userName: string;
  userEmail: string;

  /** Endpoint paths, relative to `apiBaseUrl`. Override for any backend. */
  endpoints: {
    user: string;
    history: string;
    /** May contain `{project_id}` — substituted by the GrokBase adapter. */
    stream: string;
  };
}

/** Keys read from the build environment (Vite `VITE_*` / Next.js `NEXT_PUBLIC_*`). */
interface EnvLike {
  VITE_API_URL?: string;
  NEXT_PUBLIC_API_URL?: string;
  VITE_API_MODE?: string;
  VITE_STREAM_MODE?: string;
  VITE_MODEL?: string;
  VITE_TEMPERATURE?: string;
  VITE_MAX_TOKENS?: string;
  VITE_AUTH_TOKEN?: string;
  VITE_PROJECT_ID?: string;
  VITE_TOP_K?: string;
  VITE_USER_NAME?: string;
  VITE_USER_EMAIL?: string;
  VITE_USER_ENDPOINT?: string;
  VITE_HISTORY_ENDPOINT?: string;
  VITE_STREAM_ENDPOINT?: string;
}

const ENV = import.meta.env as unknown as EnvLike;

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined);
}

function numberFrom(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function adapterModeFrom(raw: string | undefined): AdapterMode | undefined {
  return raw === "rest" || raw === "mock" ? raw : undefined;
}

function streamModeFrom(raw: string | undefined): StreamMode | undefined {
  return raw === "sse" || raw === "websocket" || raw === "json" ? raw : undefined;
}

export function defaultConfig(overrides: Partial<AIChatConfig> = {}): AIChatConfig {
  const apiUrl = firstDefined(ENV.VITE_API_URL, ENV.NEXT_PUBLIC_API_URL) ?? "";
  const authToken = ENV.VITE_AUTH_TOKEN;
  const mode =
    overrides.mode ??
    adapterModeFrom(ENV.VITE_API_MODE) ??
    // Explicit URL or auth token → attempt real transport; otherwise run mock.
    (apiUrl || authToken ? "rest" : "mock");
  const streamMode = overrides.streamMode ?? streamModeFrom(ENV.VITE_STREAM_MODE) ?? "sse";

  return {
    mode,
    streamMode,
    apiBaseUrl: overrides.apiBaseUrl ?? apiUrl,
    model: overrides.model ?? ENV.VITE_MODEL ?? "gpt-4o-mini",
    temperature: overrides.temperature ?? numberFrom(ENV.VITE_TEMPERATURE, 0.4),
    maxTokens: overrides.maxTokens ?? numberFrom(ENV.VITE_MAX_TOKENS, 2048),
    headers: {
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...overrides.headers,
    },
    historyLimit: overrides.historyLimit ?? 20,
    projectId: overrides.projectId ?? numberFrom(ENV.VITE_PROJECT_ID, 1),
    topK: overrides.topK ?? numberFrom(ENV.VITE_TOP_K, 5),
    userName: overrides.userName ?? ENV.VITE_USER_NAME ?? "Guest",
    userEmail: overrides.userEmail ?? ENV.VITE_USER_EMAIL ?? "guest@localhost",
    endpoints: {
      user: overrides.endpoints?.user ?? ENV.VITE_USER_ENDPOINT ?? "/api/v1/",
      history: overrides.endpoints?.history ?? ENV.VITE_HISTORY_ENDPOINT ?? "",
      // GrokBase RAG answer endpoint ({project_id} substituted by the adapter).
      stream: overrides.endpoints?.stream ?? ENV.VITE_STREAM_ENDPOINT ?? "/api/v1/nlp/index/answer/stream/{project_id}",
    },
  };
}
