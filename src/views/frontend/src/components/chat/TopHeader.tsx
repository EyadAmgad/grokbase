/**
 * TopHeader — repository context on the left; Upgrade CTA, Share, and a
 * dropdown menu (New Chat / Pin / Reset index) on the right. Mobile menu
 * trigger included.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Menu, Pin, PinOff, Plus, RotateCcw, Rocket, Share2, SquareArrowOutUpRight } from "lucide-react";
import type { RepoSession } from "../../lib/sessions";
import { cx } from "../../lib/ui-helpers";

export interface TopHeaderProps {
  session: RepoSession | null;
  onOpenNav: () => void;
  onNewChat: () => void;
  onTogglePin: () => void;
  onResetIndex: () => void;
}

export function TopHeader({ session, onOpenNav, onNewChat, onTogglePin, onResetIndex }: TopHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const share = async () => {
    const url = session?.repoUrl ? `${session.repoUrl}` : typeof window !== "undefined" ? window.location.href : "";
    try {
      await navigator.clipboard.writeText(url);
      if (session?.repoUrl) {
        // Feedback is intentionally non-blocking; clipboard is the affordance.
        window.setTimeout(() => undefined, 0);
      }
    } catch {
      /* clipboard unavailable */
    }
  };

  const menuItems = [
    { id: "new", label: "New Chat", icon: Plus, action: onNewChat },
    session
      ? {
          id: "pin",
          label: session.pinned ? "Unpin session" : "Pin session",
          icon: session.pinned ? PinOff : Pin,
          action: onTogglePin,
        }
      : null,
    session?.repoUrl
      ? { id: "open", label: "Open repository", icon: SquareArrowOutUpRight, action: () => window.open(session.repoUrl, "_blank", "noopener") }
      : null,
    { id: "reset", label: "Reset repository index", icon: RotateCcw, danger: true as const, action: onResetIndex },
  ].filter(Boolean) as Array<{ id: string; label: string; icon: typeof Plus; action: () => void; danger?: boolean }>;

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-canvas/85 px-4 backdrop-blur-sm sm:px-5">
      <button
        type="button"
        aria-label="Open navigation menu"
        onClick={onOpenNav}
        className="grid size-9 shrink-0 place-items-center rounded-lg text-muted outline-offset-2 transition-colors hover:bg-hover hover:text-ink lg:hidden"
      >
        <Menu aria-hidden="true" className="size-5" />
      </button>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold tracking-tight text-ink sm:text-base">
          {session?.title ?? "GrokBase"}
        </h1>
        {session ? (
          <p className="truncate text-[11px] text-muted">
            {session.source === "github" ? session.repoUrl : session.fileLabel}
          </p>
        ) : (
          <p className="text-[11px] text-muted">Repository intelligence, grounded in source</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="mr-1 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white outline-offset-2 transition-colors hover:bg-accent-strong sm:text-sm"
        >
          <Rocket aria-hidden="true" className="size-3.5" />
          Upgrade
        </button>

        <button
          type="button"
          aria-label="Share repository link"
          title="Share"
          onClick={() => {
            void share();
          }}
          className="grid size-9 place-items-center rounded-lg text-muted outline-offset-2 transition-colors hover:bg-hover hover:text-ink"
        >
          <Share2 aria-hidden="true" className="size-4.5" />
        </button>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Open session options"
            onClick={() => setMenuOpen((value) => !value)}
            className="grid size-9 place-items-center rounded-lg text-muted outline-offset-2 transition-colors hover:bg-hover hover:text-ink"
          >
            <ChevronDown aria-hidden="true" className="size-4.5" />
          </button>

          {menuOpen ? (
            <div
              role="menu"
              aria-label="Session options"
              className="absolute right-0 top-full z-40 mt-1.5 w-60 rounded-xl border border-line bg-card p-1.5 shadow-elevated"
            >
              {menuItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      item.action();
                    }}
                    className={cx(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-offset-2 transition-colors",
                      item.danger ? "text-danger hover:bg-hover" : "text-ink hover:bg-hover",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
