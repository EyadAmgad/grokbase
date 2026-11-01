/**
 * ChatInput — bottom-anchored prompt box.
 *
 * Behavior (per spec):
 *   Enter        → submit        Shift+Enter → line break
 *   (IME-composition-safe so Chinese/Japanese input won't submit early)
 *   Attachments → staged chips, forwarded to the adapter payload
 *   Streaming   → submit becomes a Stop button (aborts the stream)
 *
 * Accessibility: form with labelled textarea, live send-state text, and a
 * visually hidden but focusable helper about keyboard shortcuts.
 */

import { useEffect, useId, useRef } from "react";
import { Paperclip, SendHorizontal, Square, X } from "lucide-react";
import { useAIChat } from "../../providers/AIChatProvider";
import { cx, formatBytes } from "../../lib/ui-helpers";
import type { ComposerAttachment } from "../../lib/types";

const MAX_TEXTAREA_ROWS = 6;

/** Auto-grow textarea that stops expanding at `MAX_TEXTAREA_ROWS`. */function useAutoResize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_ROWS * 24 + 28)}px`;
  }, [value]);
  return ref;
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: ComposerAttachment;
  onRemove: (id: string) => void;
}) {
  return (
    <span className="flex max-w-full items-center gap-1.5 rounded-full bg-canvas px-2.5 py-1 text-xs text-muted ring-1 ring-line">
      <span className="truncate font-medium text-ink">{attachment.name}</span>
      <span className="shrink-0 tabular-nums">{formatBytes(attachment.size)}</span>
      <button
        type="button"
        aria-label={`Remove attachment ${attachment.name}`}
        onClick={() => onRemove(attachment.id)}
        className="grid size-4 shrink-0 place-items-center rounded-full text-muted outline-offset-2 transition-colors hover:text-ink"
      >
        <X aria-hidden="true" className="size-3" />
      </button>
    </span>
  );
}

export function ChatInput() {
  const {
    draft,
    setDraft,
    attachments,
    addAttachments,
    removeAttachment,
    sendMessage,
    sendError,
    isStreaming,
    stopStreaming,
    retryLast,
    registerComposerFocus,
  } = useAIChat();

  const textareaRef = useAutoResize(draft);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hintTextId = useId();

  const canSend = draft.trim().length > 0 && !isStreaming;

  useEffect(() => {
    registerComposerFocus(() => textareaRef.current?.focus());
    // Auto-resize ref identity is stable across renders.
  }, [registerComposerFocus, textareaRef]);

  const submit = () => {
    if (!canSend) return;
    sendMessage();
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    // Respect IME composition (Enter confirms the candidate, not the message).
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="mx-auto w-full max-w-3xl"
      aria-describedby={hintTextId}
    >
      {sendError ? (
        <p
          role="alert"
          className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          <span className="min-w-0 truncate">{sendError}</span>
          <button
            type="button"
            onClick={retryLast}
            disabled={isStreaming}
            className="shrink-0 font-semibold underline underline-offset-2 outline-offset-2 disabled:opacity-50"
          >
            Retry
          </button>
        </p>
      ) : null}

      <div
        className={cx(
          "flex flex-col gap-2 rounded-3xl border border-line bg-surface p-2 shadow-card transition-colors",
          "focus-within:border-accent/60",
        )}
      >
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-2 pt-1">
            {attachments.map((attachment) => (
              <AttachmentChip key={attachment.id} attachment={attachment} onRemove={removeAttachment} />
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <button
            type="button"
            aria-label="Attach files"
            title="Attach files"
            onClick={() => {
              fileInputRef.current?.click();
            }}
            className="grid size-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-canvas hover:text-ink"
          >
            <Paperclip aria-hidden="true" className="size-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              if (event.target.files?.length) addAttachments(event.target.files);
              event.target.value = "";
            }}
          />

          <textarea
            id="chat-composer"
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            aria-label="Message the AI"
            aria-keyshortcuts="Enter"
            placeholder="Ask about the repository…"
            className="max-h-[172px] min-h-[40px] w-full flex-1 resize-none bg-transparent px-1 py-2.5 text-sm text-ink outline-none placeholder:text-muted sm:text-[15px]"
          />

          {isStreaming ? (
            <button
              type="button"
              aria-label="Stop generating"
              title="Stop generating"
              onClick={stopStreaming}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-card transition-colors hover:bg-white"
            >
              <Square aria-hidden="true" className="size-4 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send message"
              title="Send (Enter)"
              disabled={!canSend}
              aria-disabled={!canSend}
              className={cx(
                "grid size-10 shrink-0 place-items-center rounded-full transition-all",
                canSend
                  ? "bg-accent text-white hover:bg-accent-strong"
                  : "bg-canvas text-muted hover:bg-line",
              )}
            >
              <SendHorizontal aria-hidden="true" className="size-5" />
            </button>
          )}
        </div>
      </div>

      <p id={hintTextId} className="mt-2 text-center text-xs text-muted">
        <span className="sr-only">Keyboard shortcuts: </span>
        Enter to send · Shift + Enter for a new line
      </p>
    </form>
  );
}
