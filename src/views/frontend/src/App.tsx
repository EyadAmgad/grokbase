/**
 * App composition — session orchestration + the chat workspace.
 *
 * Sessions live client-side (lib/sessions.ts); each binds a numeric backend
 * project id. The AIChatProvider is remounted per active session via the
 * React `key`, so config.projectId, history loading, and streaming target all
 * follow the selected conversation. The adapter layer (grokbaseAdapter → SSE
 * answer stream) is unchanged.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AIChatProvider } from "./providers/AIChatProvider";
import { defaultConfig } from "./lib/config";
import { grokbaseAdapter } from "./lib/adapter/grokbaseAdapter";
import { mockAdapter } from "./lib/adapter/mockAdapter";
import { ChatWorkspace } from "./components/chat/ChatWorkspace";
import { UploadModal, type UploadResult } from "./components/chat/UploadModal";
import {
  loadSessions,
  saveSessions,
  type RepoSession,
} from "./lib/sessions";
import { ingestGitRepository } from "./lib/repo-client";
import { buildRepoUrl, sanitizeRepoUrlForDisplay } from "./lib/sessions";

const baseConfig = defaultConfig();
/** rest → real backend adapter; mock → offline demo (build-time env driven). */
const adapter = baseConfig.mode === "rest" ? grokbaseAdapter : mockAdapter;

export default function App() {
  const [sessions, setSessions] = useState<RepoSession[]>(() => loadSessions());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const activeSession = useMemo(() => sessions.find((s) => s.id === activeId) ?? null, [sessions, activeId]);

  // Clean up deleted sessions on mount; open the modal on a blank slate.
  useEffect(() => {
    if (sessions.length === 0) {
      setModalOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitSessions = useCallback((next: RepoSession[]) => {
    setSessions(next);
    saveSessions(next);
  }, []);

  const createSessionFromUpload = useCallback(
    (result: UploadResult) => {
      const now = Date.now();
      const session: RepoSession = {
        id: `session-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        projectId: result.projectId,
        title: result.title,
        source: result.source,
        repoUrl: result.repoUrl ? sanitizeRepoUrlForDisplay(result.repoUrl) : undefined,
        fileLabel: result.fileLabel,
        pinned: false,
        createdAt: now,
        lastOpenedAt: now,
      };
      commitSessions([session, ...sessions]);
      setActiveId(session.id);
    },
    [commitSessions, sessions],
  );

  const selectSession = useCallback(
    (id: string) => {
      const next = sessions.map((session) =>
        session.id === id ? { ...session, lastOpenedAt: Date.now() } : session,
      );
      commitSessions(next);
      setActiveId(id);
    },
    [commitSessions, sessions],
  );

  const togglePin = useCallback(
    (id: string) => {
      commitSessions(sessions.map((session) => (session.id === id ? { ...session, pinned: !session.pinned } : session)));
    },
    [commitSessions, sessions],
  );

  const deleteSession = useCallback(
    (id: string) => {
      const next = sessions.filter((session) => session.id !== id);
      commitSessions(next);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
    },
    [activeId, commitSessions, sessions],
  );

  /**
   * "Reset repository index" — re-ingests the same source with do_reset=1,
   * wiping the project's vector collection and chunks in the backend.
   */
  const resetIndex = useCallback(async () => {
    const session = activeSession;
    if (!session) return;
    try {
      if (session.source === "github" && session.repoUrl) {
        await ingestGitRepository(session.projectId, {
          repoUrl: buildRepoUrl(session.repoUrl),
          doReset: true,
        });
      } else if (session.source === "upload") {
        // Re-ingest requires the original archive — instruct the user instead
        // of silently resetting an index we cannot rebuild.
        setModalOpen(true);
      }
    } catch {
      /* status surfaced through the open modal / composer; keep it simple */
    }
  }, [activeSession]);

  const openModal = useCallback(() => {
    setActiveId(null);
    setModalOpen(true);
  }, []);

  // Per-session config: the projectId rides the provider key below.
  const sessionConfig = useMemo(
    () => defaultConfig({ projectId: activeSession?.projectId ?? baseConfig.projectId, userName: "Guest" }),
    [activeSession?.projectId],
  );

  return (
    <>
      <AIChatProvider key={sessionConfig.projectId} config={sessionConfig} adapter={adapter}>
        <ChatWorkspace
          session={activeSession}
          handlers={{
            sessions,
            activeId,
            onSelect: selectSession,
            onNewChat: openModal,
            onTogglePin: togglePin,
            onDelete: deleteSession,
            onResetIndex: () => {
              void resetIndex();
            },
            onOpenNav: () => {
              /* Toggle handled internally via navOpen state below */
              setNavOpen(true);
            },
            onCloseNav: () => setNavOpen(false),
            navOpen: navOpen,
          }}
        />
      </AIChatProvider>

      <UploadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onStartSession={createSessionFromUpload}
      />
    </>
  );
}
