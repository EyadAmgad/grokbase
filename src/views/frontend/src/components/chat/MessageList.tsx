/**
 * MessageList — ChatGPT-style transcript: full-width assistant messages with
 * structured Markdown (headers, lists, GFM tables, code blocks with copy),
 * right-aligned user bubbles, streaming caret, copy message, inline errors.
 */

import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Check, Copy, RefreshCw, TriangleAlert, User } from "lucide-react";
import { useAIChat } from "../../providers/AIChatProvider";
import { cx } from "../../lib/ui-helpers";

function StreamingCaret() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-caret-blink rounded-full bg-accent"
    />
  );
}

function CopyButton({ getText, label }: { getText: () => string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(getText());
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="inline-flex items-center gap-1 rounded-md p-1 text-muted outline-offset-2 transition-colors hover:bg-hover hover:text-ink"
    >
      {copied ? <Check aria-hidden="true" className="size-3.5 text-accent" /> : <Copy aria-hidden="true" className="size-3.5" />}
      <span className="sr-only">{copied ? "Copied" : label}</span>
    </button>
  );
}

/** Code block with language label + copy-to-clipboard button. */
function CodeBlock(props: React.ComponentProps<"code"> & { node?: unknown }) {
  const { children, className, node, ...rest } = props;
  void node;
  const text = String(children).replace(/\n$/, "");
  const isBlock = /language-/.test(className || "") || text.includes("\n");
  const language = /language-([\w-]+)/.exec(className || "")?.[1];

  if (!isBlock) {
    return (
      <code className="rounded-md bg-card px-1.5 py-0.5 text-[0.85em] text-accent" {...rest}>
        {children}
      </code>
    );
  }

  return (
    <div className="group/code my-3 overflow-hidden rounded-xl border border-line bg-[#0d0d0d]">
      <div className="flex items-center justify-between border-b border-line bg-card px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{language ?? "code"}</span>
        <CopyButton label="Copy code" getText={() => text} />
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 text-[13px] leading-relaxed">
        <code className={className} {...rest}>
          {text}
        </code>
      </pre>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose-invert space-y-3 text-sm leading-relaxed text-ink [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:ml-0 [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_hr]:border-line [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:my-3 [&_ol]:space-y-0.5 [&_ol]:pl-6 [&_p]:my-2 [&_strong]:font-semibold [&_table]:w-full [&_table]:border-collapse [&_table]:text-[13px] [&_td]:border [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:border [&_th]:border-line [&_th]:bg-card [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold [&_tr]:border-b [&_tr]:border-line [&_ul]:list-disc [&_ul]:my-3 [&_ul]:space-y-0.5 [&_ul]:pl-5">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeBlock,
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}

function MessageRow({ messageId }: { messageId: string }) {
  const { messages, retryLast, isStreaming } = useAIChat();
  const message = messages.find((entry) => entry.id === messageId);

  if (!message || message.sender === "system") return null;

  const isUser = message.sender === "user";
  const failed = message.status === "error";

  return (
    <li className="group flex w-full flex-col gap-2">
      <div className={cx("flex items-start gap-3", isUser && "flex-row-reverse")}>
        <span
          aria-hidden="true"
          className={cx(
            "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-line",
            isUser ? "bg-card text-muted" : "bg-accent-soft text-accent",
          )}
        >
          {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
        </span>

        <div
          className={cx(
            "min-w-0",
            isUser ? "max-w-[85%] sm:max-w-[75%]" : "flex-1",
          )}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap rounded-2xl bg-card px-4 py-2.5 text-sm leading-relaxed text-ink sm:text-[15px]">
              {message.content}
            </div>
          ) : failed && !message.content ? (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">The response failed. Please try again.</span>
            </div>
          ) : (
            <div data-streaming={message.status === "streaming"}>
              {message.content ? (
                <MarkdownContent content={message.content} />
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <span className="flex gap-1" aria-label="Assistant is responding">
                    {[0, 1, 2].map((dot) => (
                      <span
                        key={dot}
                        className="size-1.5 animate-bounce rounded-full bg-muted"
                        style={{ animationDelay: `${dot * 150}ms` }}
                      />
                    ))}
                  </span>
                  <span className="sr-only">Assistant is responding…</span>
                </div>
              )}
              {message.status === "streaming" ? <StreamingCaret /> : null}
            </div>
          )}
        </div>
      </div>

      {/* Hover actions */}
      <div
        className={cx(
          "flex items-center gap-1 pl-10 text-xs text-muted transition-opacity",
          isUser && "flex-row-reverse pl-0 pr-10",
          "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
        )}
      >
        {!isUser && message.content ? (
          <CopyButton label="Copy message" getText={() => message.content} />
        ) : null}
        {failed ? (
          <button
            type="button"
            onClick={retryLast}
            disabled={isStreaming}
            className="inline-flex items-center gap-1 rounded-md px-1 font-medium text-accent outline-offset-2 transition-colors hover:text-ink disabled:opacity-50"
          >
            <RefreshCw aria-hidden="true" className="size-3" />
            Retry
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function MessageList() {
  const { messages, historyState } = useAIChat();
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep newest content in view, without yanking the page if the user
  // scrolled away while streaming.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 160;
    if (nearBottom) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, messages[messages.length - 1]?.content]);

  if (historyState === "error" && messages.length === 0) {
    return (
      <div className="mx-auto my-auto max-w-md text-center text-sm text-muted" role="alert">
        Could not load earlier messages. You can keep chatting below.
      </div>
    );
  }

  if (messages.length === 0) return null;

  return (
    <div ref={scrollRef} className="min-h-0 flex-1">
      <ol
        role="log"
        aria-label="Conversation messages"
        className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-5"
      >
        {messages.map((message) => (
          <MessageRow key={message.id} messageId={message.id} />
        ))}
        <div ref={endRef} aria-hidden="true" />
      </ol>
      {historyState === "error" ? (
        <p className="mx-auto max-w-3xl px-4 text-xs text-muted">Could not load earlier messages.</p>
      ) : null}
    </div>
  );
}
