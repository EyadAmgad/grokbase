/**
 * EmptyState — repository-focused start view: welcome, prompt shortcut grid,
 * and loading/error states for the backend profile ping.
 */

import { RefreshCw, TriangleAlert, FolderGit2 } from "lucide-react";
import { useAIChat } from "../../providers/AIChatProvider";
import { firstName } from "../../lib/ui-helpers";
import { PromptCardGrid } from "./PromptCardGrid";

export function EmptyState({ onNewChat }: { onNewChat?: () => void }) {
  const { user, userState, userError, fetchUser } = useAIChat();

  if (userState === "error") {
    return (
      <div
        className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-line bg-card p-8 text-center shadow-card"
        role="alert"
      >
        <TriangleAlert aria-hidden="true" className="size-8 text-danger" />
        <div>
          <h2 className="text-base font-semibold text-ink">Couldn't reach the backend</h2>
          <p className="mt-1 text-sm text-muted">{userError ?? "An unexpected error occurred."}</p>
        </div>
        <button
          type="button"
          onClick={() => fetchUser()}
          className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-strong"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 pb-2 pt-2">
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          aria-hidden="true"
          className="grid size-14 place-items-center rounded-2xl border border-line bg-card text-accent"
        >
          <FolderGit2 className="size-7" />
        </span>
        <h2 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
          {userState === "loading" ? (
            <span className="inline-block h-8 w-52 animate-pulse rounded-lg bg-card align-middle" aria-label="Loading welcome message" />
          ) : (
            <>
              Welcome back, {firstName(user?.name || "Guest")}
            </>
          )}
        </h2>
        <p className="max-w-md text-sm leading-relaxed text-muted">
          Ask anything about the connected repository — architecture, features, code paths — answered from its indexed source.
        </p>
        {onNewChat ? (
          <button
            type="button"
            onClick={onNewChat}
            className="mt-1 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white outline-offset-2 transition-colors hover:bg-accent-strong"
          >
            <FolderGit2 aria-hidden="true" className="size-4" />
            Connect a repository
          </button>
        ) : null}
      </div>

      <PromptCardGrid loaded={userState !== "loading"} />
    </div>
  );
}
