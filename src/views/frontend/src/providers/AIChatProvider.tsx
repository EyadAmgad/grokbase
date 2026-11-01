/**
 * AIChatProvider — the single source of truth for chat state.
 *
 * Exposes `useAIChat()` with the abstract operations required by the spec:
 *   sendMessage(payload), selectPreset(prompt), fetchUser(), fetchHistory()
 * plus streaming control (stop), attachment staging, and retry-on-error.
 *
 * All backend specifics live behind the `AIChatAdapter` interface, so this
 * provider is written ONCE and works with any API/mock implementation.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { AIChatConfig } from "../lib/config";
import type { AIChatAdapter, StreamHandlers } from "../lib/adapter/types";
import { saveSessionMessages } from "../lib/sessions";
import type {
  ChatMessage,
  ChatRequestPayload,
  ComposerAttachment,
  RequestState,
  UserProfile,
} from "../lib/types";

export interface AIChatContextValue {
  /** Resolved runtime config (for components that surface, e.g., model names). */
  config: AIChatConfig;

  /* ------------------------------ user ------------------------------ */
  user: UserProfile | null;
  userState: RequestState;
  userError: string | null;
  fetchUser: () => void;

  /* ----------------------------- history ----------------------------- */
  historyState: RequestState;
  historyError: string | null;
  fetchHistory: () => void;

  /* ---------------------------- transcript --------------------------- */
  messages: ChatMessage[];

  /* ----------------------------- composer ---------------------------- */
  draft: string;
  setDraft: (value: string) => void;
  attachments: ComposerAttachment[];
  addAttachments: (files: Iterable<File>) => void;
  removeAttachment: (id: string) => void;

  /* -------------------------- send + stream -------------------------- */
  isStreaming: boolean;
  /** Stream-level failure of the most recent turn (distinct from per-message). */
  sendError: string | null;
  sendMessage: (content?: string) => void;
  selectPreset: (prompt: string) => void;
  retryLast: () => void;
  stopStreaming: () => void;

  /** Internal: lets <ChatInput /> expose its textarea to the provider. */
  registerComposerFocus: (focus: () => void) => void;
}

const AIChatContext = createContext<AIChatContextValue | null>(null);

export function useAIChat(): AIChatContextValue {
  const context = useContext(AIChatContext);
  if (!context) {
    throw new Error("useAIChat must be used within an <AIChatProvider>.");
  }
  return context;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function messageToText(value: string | null): string | null {
  return value && value.trim().length > 0 ? value : null;
}

export interface AIChatProviderProps {
  adapter: AIChatAdapter;
  config: AIChatConfig;
  children: ReactNode;
}

export function AIChatProvider({ adapter, config, children }: AIChatProviderProps) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [userState, setUserState] = useState<RequestState>("idle");
  const [userError, setUserError] = useState<string | null>(null);

  const [historyState, setHistoryState] = useState<RequestState>("idle");
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const composerFocusRef = useRef<(() => void) | null>(null);

  /* ------------------------- backend loaders ------------------------- */

  const fetchUser = useCallback(
    (signal?: AbortSignal) => {
      setUserState("loading");
      setUserError(null);
      adapter
        .fetchUser(config, signal ?? new AbortController().signal)
        .then((profile) => {
          setUser(profile);
          setUserState("ready");
        })
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          setUserState("error");
          setUserError(
            error instanceof Error ? error.message : "Could not load your profile.",
          );
        });
    },
    [adapter, config],
  );

  const fetchHistory = useCallback(
    (signal?: AbortSignal) => {
      setHistoryState("loading");
      setHistoryError(null);
      adapter
        .fetchHistory(config, signal ?? new AbortController().signal)
        .then((rows) => {
          setMessages(rows);
          setHistoryState("ready");
        })
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          setHistoryState("error");
          setHistoryError(
            error instanceof Error ? error.message : "Could not load your conversation history.",
          );
        });
    },
    [adapter, config],
  );

  // Load user + history on mount. Abort on unmount / re-run (StrictMode-safe).
  useEffect(() => {
    const controller = new AbortController();
    fetchUser(controller.signal);
    fetchHistory(controller.signal);
    return () => controller.abort();
  }, [fetchUser, fetchHistory]);

  /* --------------------------- attachments --------------------------- */

  const addAttachments = useCallback((files: Iterable<File>) => {
    setAttachments((previous) => [
      ...previous,
      ...Array.from(files).map((file) => ({
        id: uid("attach"),
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
      })),
    ]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((previous) => previous.filter((file) => file.id !== id));
  }, []);

  /* -------------------------- send pipeline -------------------------- */

  const runStream = useCallback(
    (userMessage: ChatMessage, history: ChatMessage[], assistantId: string) => {
      const controller = new AbortController();
      abortRef.current = controller;

      const payload: ChatRequestPayload = {
        message: userMessage.content,
        history,
        attachments,
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      };

      const handlers: StreamHandlers = {
        onDelta: (chunk) => {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    status: "streaming",
                    content: message.content + chunk,
                  }
                : message,
            ),
          );
        },
        onDone: () => {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    // Stop-after-abort keeps the partial answer as a normal turn.
                    status: message.content ? "complete" : "error",
                    content: message.content || "_Generation was stopped before any output._",
                  }
                : message,
            ),
          );
          setIsStreaming(false);
          setSendError(null);
          abortRef.current = null;
        },
        onError: (error) => {
          const cancelled = (error as { kind?: string }).kind === "cancelled";
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    status: cancelled && message.content ? "complete" : "error",
                  }
                : message,
            ),
          );
          setIsStreaming(false);
          setSendError(cancelled ? null : error.message || "The response failed. Please try again.");
          abortRef.current = null;
        },
      };

      setIsStreaming(true);
      setSendError(null);
      adapter.streamCompletion(payload, config, handlers, controller.signal).catch((error: unknown) => {
        // Double safety: any adapter rejection (instead of onError) still resolves
        // the UI state so the workspace never hangs in a streaming state.
        handlers.onError(
          error instanceof Error ? error : new Error("The response failed. Please try again."),
        );
      });
    },
    [adapter, config, attachments],
  );

  const sendMessage = useCallback(
    (content?: string) => {
      const text = messageToText(content ?? draft);
      if (!text || isStreaming) return;

      const userMessage: ChatMessage = {
        id: uid("user"),
        sender: "user",
        content: text,
        timestamp: Date.now(),
        status: "complete",
      };
      const assistantMessage: ChatMessage = {
        id: uid("assistant"),
        sender: "assistant",
        content: "",
        timestamp: Date.now(),
        status: "sending",
      };

      // History is captured from the current snapshot; the state update below
      // stays pure (no side effects inside updaters — StrictMode-safe).
      const history = messages.slice(-config.historyLimit);
      setMessages((previous) => [...previous, userMessage, assistantMessage]);
      setDraft("");
      setAttachments([]);
      runStream(userMessage, history, assistantMessage.id);
    },
    [draft, isStreaming, runStream, messages, config.historyLimit],
  );

  const retryLast = useCallback(() => {
    if (isStreaming) return;
    const lastUserIndex = [...messages].reverse().findIndex((message) => message.sender === "user");
    if (lastUserIndex === -1) return;
    const lastUser = messages[messages.length - 1 - lastUserIndex];
    if (!lastUser) return;

    const history = messages
      .slice(0, messages.length - lastUserIndex)
      .slice(-config.historyLimit);
    const assistantMessage: ChatMessage = {
      id: uid("assistant"),
      sender: "assistant",
      content: "",
      timestamp: Date.now(),
      status: "sending",
    };
    setMessages((previous) => [...previous, assistantMessage]);
    runStream(lastUser, history, assistantMessage.id);
  }, [isStreaming, messages, runStream, config.historyLimit]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const selectPreset = useCallback(
    (prompt: string) => {
      setDraft(prompt);
      composerFocusRef.current?.();
    },
    [],
  );

  // Session transcript persistence (client-side store; backend keeps none).
  // Written whenever streaming settles so partial turns aren't stored mid-run.
  // Gated on history load: without the guard the empty initial state would
  // wipe the stored transcript before fetchHistory resolves.
  useEffect(() => {
    if (historyState === "idle" || historyState === "loading" || isStreaming) return;
    saveSessionMessages(config.projectId, messages);
  }, [messages, isStreaming, config.projectId, historyState]);

  const registerComposerFocus = useCallback((focus: () => void) => {
    composerFocusRef.current = focus;
  }, []);

  const value = useMemo<AIChatContextValue>(
    () => ({
      config,
      user,
      userState,
      userError,
      fetchUser,
      historyState,
      historyError,
      fetchHistory,
      messages,
      draft,
      setDraft,
      attachments,
      addAttachments,
      removeAttachment,
      isStreaming,
      sendError,
      sendMessage,
      selectPreset,
      retryLast,
      stopStreaming,
      registerComposerFocus,
    }),
    [
      config,
      user,
      userState,
      userError,
      fetchUser,
      historyState,
      historyError,
      fetchHistory,
      messages,
      draft,
      attachments,
      addAttachments,
      removeAttachment,
      isStreaming,
      sendError,
      sendMessage,
      selectPreset,
      retryLast,
      stopStreaming,
      registerComposerFocus,
    ],
  );

  return <AIChatContext.Provider value={value}>{children}</AIChatContext.Provider>;
}
