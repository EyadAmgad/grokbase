/**
 * Sidebar — brand, "New Chat" action, session history (Pinned / Recents), and
 * the profile card. Deliberately free of non-essential nav items.
 *
 * Session state is owned by the parent (App); this shell renders it drawer
 * aware. Accessibility mirrors the drawer contract: Escape closes, focus moves
 * to the close trigger on open, every icon-only control has a name.
 */

import { useEffect, useRef } from "react";
import { FolderGit2, MessageSquarePlus, Pin, PinOff, Settings2, Trash2, X } from "lucide-react";
import type { RepoSession } from "../../lib/sessions";
import { initials } from "../../lib/ui-helpers";
import { cx } from "../../lib/ui-helpers";

function relativeDay(timestamp: number): string {
  const dayMs = 24 * 60 * 60_000;
  const days = Math.floor((Date.now() - timestamp) / dayMs);
  if (days <= 0) {
    return new Date(timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SessionRow({
  session,
  active,
  onSelect,
  onTogglePin,
  onDelete,
}: {
  session: RepoSession;
  active: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cx(
        "group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm outline-offset-2 transition-colors",
        active ? "bg-hover text-ink" : "text-muted hover:bg-hover/60 hover:text-ink",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <FolderGit2
          aria-hidden="true"
          className={cx("size-4 shrink-0", active ? "text-accent" : "text-muted group-hover:text-ink")}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{session.title}</span>
          <span className="block truncate text-[11px] text-muted/80">
            {relativeDay(session.lastOpenedAt)}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={session.pinned ? `Unpin ${session.title}` : `Pin ${session.title}`}
        title={session.pinned ? "Unpin" : "Pin"}
        onClick={onTogglePin}
        className="grid size-7 shrink-0 place-items-center rounded-lg text-muted opacity-0 outline-offset-2 transition-all hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
      >
        {session.pinned ? <PinOff aria-hidden="true" className="size-3.5" /> : <Pin aria-hidden="true" className="size-3.5" />}
      </button>
      <button
        type="button"
        aria-label={`Delete ${session.title}`}
        title="Delete"
        onClick={onDelete}
        className="grid size-7 shrink-0 place-items-center rounded-lg text-muted opacity-0 outline-offset-2 transition-all hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
      </button>
      {session.pinned ? (
        <Pin aria-hidden="true" className="ml-auto hidden size-3 shrink-0 text-accent group-hover:hidden" />
      ) : null}
    </div>
  );
}

function SessionGroup({ label, sessions, activeId, onSelect, onTogglePin, onDelete }: {
  label: string;
  sessions: RepoSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (sessions.length === 0) return null;
  return (
    <section aria-label={label} className="mb-5">
      <h2 className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted/70">{label}</h2>
      <ul className="space-y-0.5">
        {sessions.map((session) => (
          <li key={session.id}>
            <SessionRow
              session={session}
              active={session.id === activeId}
              onSelect={() => onSelect(session.id)}
              onTogglePin={() => onTogglePin(session.id)}
              onDelete={() => onDelete(session.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

const ACCOUNT_TIER = "Guest · Standard indexing";

export function Sidebar({
  drawer,
  open,
  onClose,
  sessions,
  activeId,
  userName,
  userEmail,
  onSelect,
  onNewChat,
  onTogglePin,
  onDelete,
}: {
  drawer: boolean;
  open: boolean;
  onClose: () => void;
  sessions: RepoSession[];
  activeId: string | null;
  userName: string;
  userEmail: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!drawer || !open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawer, open]);

  useEffect(() => {
    if (!drawer || !open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawer, open, onClose]);

  const pinned = sessions.filter((session) => session.pinned);
  const recents = [...sessions]
    .filter((session) => !session.pinned)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);

  const content = (
    <div className="flex h-full flex-col gap-3 bg-surface">
      {/* New chat */}
      <div className="flex items-center gap-2.5 p-3">
        <button
          type="button"
          onClick={() => {
            onClose();
            onNewChat();
          }}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-line bg-card px-3 py-2.5 text-left text-sm font-medium text-ink outline-offset-2 transition-colors hover:bg-hover"
        >
          <MessageSquarePlus aria-hidden="true" className="size-4.5 shrink-0 text-accent" />
          <span className="truncate">New Chat</span>
        </button>
        {drawer ? (
          <button
            ref={closeRef}
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted outline-offset-2 transition-colors hover:bg-hover hover:text-ink lg:hidden"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        ) : null}
      </div>

      {/* History */}
      <nav aria-label="Chat history" className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {sessions.length === 0 ? (
          <p className="mt-6 px-2 text-sm leading-relaxed text-muted">
            No conversations yet. Start a new chat and connect a repository.
          </p>
        ) : (
          <>
            <SessionGroup
              label="Pinned"
              sessions={pinned}
              activeId={activeId}
              onSelect={(id) => {
                onClose();
                onSelect(id);
              }}
              onTogglePin={onTogglePin}
              onDelete={onDelete}
            />
            <SessionGroup
              label="Recents"
              sessions={recents}
              activeId={activeId}
              onSelect={(id) => {
                onClose();
                onSelect(id);
              }}
              onTogglePin={onTogglePin}
              onDelete={onDelete}
            />
          </>
        )}
      </nav>

      {/* Profile */}
      <div className="mx-3 mb-3 rounded-2xl border border-line bg-card p-3 shadow-card">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
          >
            {initials(userName || "Guest")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{userName || "Guest"}</p>
            <p className="truncate text-xs text-muted">{userEmail || "guest@localhost"}</p>
          </div>
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted">
            <Settings2 className="size-4" />
          </span>
        </div>
        <p className="mt-2 truncate rounded-lg bg-canvas px-2.5 py-1.5 text-[11px] text-muted">{ACCOUNT_TIER}</p>
      </div>
    </div>
  );

  return (
    <aside aria-label="Chat navigation" className="contents">
      {/* Desktop: fixed column */}
      <div className="sticky top-0 hidden h-dvh w-[260px] shrink-0 border-r border-line bg-surface lg:block">
        {content}
      </div>

      {/* Mobile: drawer */}
      {drawer ? (
        <div aria-hidden={!open} className={cx("lg:hidden", !open && "invisible")}>
          <div
            className={cx(
              "fixed inset-0 z-40 bg-black/60 transition-opacity duration-200",
              open ? "opacity-100" : "opacity-0",
            )}
            onClick={onClose}
          />
          <div
            role="dialog"
            aria-modal={open || undefined}
            aria-label="Chat navigation"
            className={cx(
              "fixed inset-y-0 left-0 z-50 w-[290px] max-w-[85vw] border-r border-line bg-surface shadow-elevated transition-transform duration-250",
              open ? "translate-x-0" : "-translate-x-full",
            )}
          >
            {content}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
