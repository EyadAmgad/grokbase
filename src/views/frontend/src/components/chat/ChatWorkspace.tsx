/**
 * ChatWorkspace — dark chat shell: sidebar (drawer aware) + header + centered
 * transcript + bottom-anchored composer. The upload modal is owned by the
 * parent (App) since it also creates the session.
 *
 * The provider is remounted by the parent per active session (key=sessionId),
 * so config.projectId — and therefore history + streaming target — is correct.
 */

import { useAIChat } from "../../providers/AIChatProvider";
import { Sidebar } from "./Sidebar";
import { TopHeader } from "./TopHeader";
import { EmptyState } from "./EmptyState";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import type { RepoSession } from "../../lib/sessions";

export interface WorkspaceHandlers {
  sessions: RepoSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  onResetIndex: () => void;
  onOpenNav: () => void;
  onCloseNav: () => void;
  navOpen: boolean;
}

export function ChatWorkspace({ session, handlers }: { session: RepoSession | null; handlers: WorkspaceHandlers }) {
  const { user, messages, config } = useAIChat();

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <a
        href="#chat-composer"
        className="sr-only sr-only-focusable rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
      >
        Skip to chat input
      </a>

      <Sidebar
        drawer
        open={handlers.navOpen}
        onClose={handlers.onCloseNav}
        sessions={handlers.sessions}
        activeId={handlers.activeId}
        userName={user?.name ?? "Guest"}
        userEmail={user?.email ?? "guest@localhost"}
        onSelect={handlers.onSelect}
        onNewChat={handlers.onNewChat}
        onTogglePin={handlers.onTogglePin}
        onDelete={handlers.onDelete}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopHeader
          session={session}
          onOpenNav={handlers.onOpenNav}
          onNewChat={handlers.onNewChat}
          onTogglePin={() => {
            if (session) handlers.onTogglePin(session.id);
          }}
          onResetIndex={handlers.onResetIndex}
        />

        <main
          aria-label="Chat"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          {messages.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col px-4 sm:px-6">
              <MessageList />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center px-4 py-6 sm:px-6">
              <EmptyState onNewChat={handlers.onNewChat} />
            </div>
          )}
        </main>

        {/* Composer */}
        <div className="shrink-0 bg-canvas px-4 pb-3 pt-1 sm:px-6 sm:pb-4">
          <div className="mx-auto w-full max-w-3xl">
            <ChatInput />
            <p className="mt-2 text-center text-[11px] text-muted/70">
              Answers are generated from the indexed repository.{" "}
              {`Model: ${config.model}`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
