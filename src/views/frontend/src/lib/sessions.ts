/**
 * Session store — client-side conversation registry.
 *
 * The backend (src/routes) has no account/session system: each conversation is
 * bound to a numeric project id the same way the legacy static UI did, and the
 * transcript lives in localStorage. This module is the single owner of that;
 * adapters and providers read through it, components never touch localStorage.
 */

import type { ChatMessage } from "./types";

export interface RepoSession {
  id: string;
  /** Numeric backend project — indexes + answers are project-scoped. */
  projectId: number;
  title: string;
  source: "github" | "upload";
  /** Repository URL only (token stripped — never persisted). */
  repoUrl?: string;
  fileLabel?: string;
  pinned: boolean;
  createdAt: number;
  lastOpenedAt: number;
}

const SESSIONS_KEY = "grokbase.sessions.v1";
const TRANSCRIPT_PREFIX = "grokbase.transcript.v1:";

export function generateProjectId(): number {
  // Random 9-digit int — unique enough client-side, accepted by the backend
  // (projects are created on demand per id via get_project_or_create_one).
  const value = Math.floor(100_000_000 + Math.random() * 900_000_000);
  return value;
}

export function loadSessions(): RepoSession[] {
  try {
    const raw = window.localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RepoSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: RepoSession[]): void {
  try {
    window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    /* storage unavailable — sessions simply don't persist */
  }
}

export function loadSessionMessages(projectId: number): ChatMessage[] {
  try {
    const raw = window.localStorage.getItem(TRANSCRIPT_PREFIX + String(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSessionMessages(projectId: number, messages: ChatMessage[]): void {
  try {
    if (messages.length === 0) {
      window.localStorage.removeItem(TRANSCRIPT_PREFIX + String(projectId));
      return;
    }
    window.localStorage.setItem(
      TRANSCRIPT_PREFIX + String(projectId),
      JSON.stringify(messages),
    );
  } catch {
    /* storage unavailable or full — transcripts degrade gracefully */
  }
}

/** Derives a clean human title from a repository URL ("owner/repo"). */
export function titleFromRepoUrl(repoUrl: string): string {
  try {
    const path = new URL(sanitizeRepoUrlForDisplay(repoUrl)).pathname.replace(/\.git$/, "");
    const parts = path.split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    return parts.at(-1) || "Repository chat";
  } catch {
    return "Repository chat";
  }
}

/** Builds a clone URL with an optional PAT (https://PAT@github.com/...). */
export function buildRepoUrl(repoUrl: string, token?: string | null): string {
  const trimmed = repoUrl.trim();
  if (!token || !token.trim()) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol.startsWith("http")) {
      parsed.username = token.trim();
      parsed.password = "";
      return parsed.toString();
    }
  } catch {
    /* fall through */
  }
  return trimmed;
}

/** Validates a github/gitlab/bitbucket repo URL cheaply (no network). */
export function isValidRepoUrl(repoUrl: string): boolean {
  try {
    const parsed = new URL(repoUrl.trim());
    const host = parsed.hostname.replace(/^www\./, "");
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      ["github.com", "gitlab.com", "bitbucket.org"].includes(host) &&
      parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean).length >= 2
    );
  } catch {
    return false;
  }
}

/** URL safe to display/persist: credentials (PAT) are stripped. */
export function sanitizeRepoUrlForDisplay(repoUrl: string): string {
  try {
    const parsed = new URL(repoUrl.trim());
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
    }
    return parsed.toString();
  } catch {
    return repoUrl;
  }
}
