const STORAGE_KEY = "grokbase.frontend.session.v2";
const LEGACY_STORAGE_KEY = "grokbase.frontend.session.v1";

function createId(prefix = "id") {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hashToProjectId(input) {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) % 2147483647 || 1;
}

function deriveRepoDisplayName(repoUrl) {
  const value = (repoUrl || "").trim();

  try {
    const parsedUrl = new URL(value.replace(/\.git$/i, ""));
    const segments = parsedUrl.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : value;
  } catch {
    return value;
  }
}

function createSession() {
  const sessionId = createId("session");

  return {
    sessionId,
    projectId: hashToProjectId(sessionId),
    repoUrl: "",
    repoName: "New repository",
    branch: "",
    ready: false,
    messages: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  return {
    id: typeof message.id === "string" ? message.id : createId("message"),
    role: ["user", "assistant", "system"].includes(message.role) ? message.role : "assistant",
    content: typeof message.content === "string" ? message.content : "",
    pending: Boolean(message.pending),
    interrupted: Boolean(message.interrupted),
    createdAt: typeof message.createdAt === "string" ? message.createdAt : new Date().toISOString(),
  };
}

function normalizeSession(session) {
  const fallback = createSession();
  const sessionId = typeof session?.sessionId === "string" ? session.sessionId : fallback.sessionId;

  return {
    sessionId,
    projectId: Number.isInteger(session?.projectId) ? session.projectId : hashToProjectId(sessionId),
    repoUrl: typeof session?.repoUrl === "string" ? session.repoUrl : "",
    repoName: typeof session?.repoName === "string" ? session.repoName : "New repository",
    branch: typeof session?.branch === "string" ? session.branch : "",
    ready: Boolean(session?.ready),
    messages: Array.isArray(session?.messages) ? session.messages.map(normalizeMessage).filter(Boolean) : [],
    updatedAt: typeof session?.updatedAt === "string" ? session.updatedAt : new Date().toISOString(),
  };
}

function createAppState(sessions = [createSession()]) {
  const normalizedSessions = sessions.map(normalizeSession);

  return {
    activeSessionId: normalizedSessions[0].sessionId,
    sessions: normalizedSessions,
  };
}

function migrateStoredState(rawState) {
  if (rawState && Array.isArray(rawState.sessions) && rawState.sessions.length) {
    const sessions = rawState.sessions.map(normalizeSession);
    const activeSessionId = sessions.some((session) => session.sessionId === rawState.activeSessionId)
      ? rawState.activeSessionId
      : sessions[0].sessionId;
    return { activeSessionId, sessions };
  }

  if (rawState && typeof rawState.sessionId === "string") {
    return createAppState([normalizeSession(rawState)]);
  }

  return createAppState();
}

function loadAppState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    return migrateStoredState(stored ? JSON.parse(stored) : null);
  } catch {
    return createAppState();
  }
}

function saveAppState(state) {
  const normalized = migrateStoredState(state);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Restricted browser storage should not prevent the app from working in memory.
  }

  return normalized;
}

function getActiveSession(state) {
  return state.sessions.find((session) => session.sessionId === state.activeSessionId) || state.sessions[0];
}

function addSession(state) {
  const session = createSession();
  state.sessions.unshift(session);
  state.activeSessionId = session.sessionId;
  return session;
}

function setActiveSession(state, sessionId) {
  if (state.sessions.some((session) => session.sessionId === sessionId)) {
    state.activeSessionId = sessionId;
  }

  return getActiveSession(state);
}

function updateSession(state, sessionId, changes) {
  const session = state.sessions.find((item) => item.sessionId === sessionId);

  if (session) {
    Object.assign(session, changes, { updatedAt: new Date().toISOString() });
  }

  return session;
}

function clearAppState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Ignore restricted browser storage.
  }
}

function formatProjectLabel(projectId) {
  return `Project ${projectId}`;
}

function formatSessionLabel(sessionId) {
  return sessionId.slice(0, 8);
}

export {
  addSession,
  clearAppState,
  createAppState,
  createId,
  deriveRepoDisplayName,
  formatProjectLabel,
  formatSessionLabel,
  getActiveSession,
  loadAppState,
  saveAppState,
  setActiveSession,
  updateSession,
};
