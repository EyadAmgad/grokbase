const STORAGE_KEY = "grokbase.frontend.session.v1";

function fallbackRandomUUID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

  if (!value) {
    return "";
  }

  try {
    const normalized = value.replace(/\.git$/i, "");
    const parsedUrl = new URL(normalized);
    const segments = parsedUrl.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);

    if (segments.length >= 2) {
      return `${segments[0]}/${segments[1]}`;
    }
  } catch {
    // Fall back to the raw input below.
  }

  return value;
}

function createFreshState() {
  const sessionId = fallbackRandomUUID();

  return {
    sessionId,
    projectId: hashToProjectId(sessionId),
    repoUrl: "",
    repoName: "",
    ready: false,
    messages: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  const role = message.role === "user" || message.role === "assistant" || message.role === "system"
    ? message.role
    : "assistant";

  return {
    id: typeof message.id === "string" ? message.id : fallbackRandomUUID(),
    role,
    content: typeof message.content === "string" ? message.content : "",
    pending: Boolean(message.pending),
    createdAt: typeof message.createdAt === "string" ? message.createdAt : new Date().toISOString(),
  };
}

function normalizeState(state) {
  const fallback = createFreshState();
  const sessionId = typeof state?.sessionId === "string" ? state.sessionId : fallback.sessionId;
  const projectId = Number.isInteger(state?.projectId) ? state.projectId : hashToProjectId(sessionId);

  return {
    sessionId,
    projectId,
    repoUrl: typeof state?.repoUrl === "string" ? state.repoUrl : "",
    repoName: typeof state?.repoName === "string" ? state.repoName : "",
    ready: Boolean(state?.ready),
    messages: Array.isArray(state?.messages) ? state.messages.map(normalizeMessage).filter(Boolean) : [],
    updatedAt: typeof state?.updatedAt === "string" ? state.updatedAt : new Date().toISOString(),
  };
}

function loadStoredState() {
  try {
    const rawState = localStorage.getItem(STORAGE_KEY);

    if (!rawState) {
      return createFreshState();
    }

    return normalizeState(JSON.parse(rawState));
  } catch {
    return createFreshState();
  }
}

function saveStoredState(state) {
  const normalized = normalizeState(state);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage failures in private or restricted modes.
  }

  return normalized;
}

function clearStoredState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures in private or restricted modes.
  }
}

function formatProjectLabel(projectId) {
  return `Project ${projectId}`;
}

function formatSessionLabel(sessionId) {
  return sessionId.slice(0, 8);
}

export {
  clearStoredState,
  createFreshState,
  deriveRepoDisplayName,
  formatProjectLabel,
  formatSessionLabel,
  loadStoredState,
  normalizeState,
  saveStoredState,
};