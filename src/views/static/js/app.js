import { fetchAppInfo, ingestGitHubRepository, streamRepositoryAnswer } from "./api.js";
import {
  addSession,
  clearAppState,
  createId,
  deriveRepoDisplayName,
  formatProjectLabel,
  formatSessionLabel,
  getActiveSession,
  loadAppState,
  saveAppState,
  setActiveSession,
  updateSession,
} from "./state.js";

const appState = loadAppState();
let activeSession = getActiveSession(appState);
let abortController = null;
let ingestionTimer = null;
let activeStage = 0;

const elements = {
  appSubtitle: document.getElementById("appSubtitle"),
  branchInput: document.getElementById("branchInput"),
  chatEmptyState: document.getElementById("chatEmptyState"),
  chatIntro: document.getElementById("chatIntro"),
  chatPanel: document.getElementById("chatPanel"),
  chatTitle: document.getElementById("chatTitle"),
  chunkSizeInput: document.getElementById("chunkSizeInput"),
  connectionDot: document.getElementById("connectionDot"),
  depthInput: document.getElementById("depthInput"),
  messageList: document.getElementById("messageList"),
  newSessionButton: document.getElementById("newSessionButton"),
  overlapInput: document.getElementById("overlapInput"),
  progressBar: document.getElementById("progressBar"),
  progressPanel: document.getElementById("progressPanel"),
  progressPercent: document.getElementById("progressPercent"),
  progressTitle: document.getElementById("progressTitle"),
  questionError: document.getElementById("questionError"),
  questionForm: document.getElementById("questionForm"),
  questionInput: document.getElementById("questionInput"),
  questionStatus: document.getElementById("questionStatus"),
  questionSubmitButton: document.getElementById("questionSubmitButton"),
  repoError: document.getElementById("repoError"),
  repoForm: document.getElementById("repoForm"),
  repoList: document.getElementById("repoList"),
  repoRetryButton: document.getElementById("repoRetryButton"),
  repoStatus: document.getElementById("repoStatus"),
  repoSubmitButton: document.getElementById("repoSubmitButton"),
  repoUrlInput: document.getElementById("repoUrlInput"),
  resetInput: document.getElementById("resetInput"),
  sessionDetail: document.getElementById("sessionDetail"),
  sessionLabel: document.getElementById("sessionLabel"),
  sidebarNewButton: document.getElementById("sidebarNewButton"),
  stopButton: document.getElementById("stopButton"),
  toastRegion: document.getElementById("toastRegion"),
  setupPanel: document.getElementById("setupPanel"),
};

function persist() {
  saveAppState(appState);
}

function setInlineError(element, message = "") {
  element.hidden = !message;
  element.textContent = message;
}

function errorMessage(error, fallback) {
  if (!error) return fallback;
  const prefix = error.type === "network" ? "Offline or unreachable: "
    : error.type === "server" ? "Server error: "
      : error.type === "validation" ? "Validation error: "
        : error.type === "client" ? "Request error: " : "";
  return `${prefix}${error.message || fallback}`;
}

function showToast(message, tone = "error") {
  const toast = document.createElement("div");
  toast.className = `toast toast--${tone}`;
  toast.textContent = message;
  elements.toastRegion.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function updateConnection(isOnline) {
  elements.connectionDot.classList.toggle("is-offline", !isOnline);
  elements.connectionDot.title = isOnline ? "Online" : "Offline or unreachable";
}

function renderRepoList() {
  elements.repoList.replaceChildren();

  const readySessions = appState.sessions.filter((session) => session.ready);
  const pendingSessions = appState.sessions.filter((session) => !session.ready && session.repoUrl);
  const sessions = [...readySessions, ...pendingSessions];

  if (!sessions.length) {
    const empty = document.createElement("div");
    empty.className = "repo-list-empty";
    empty.textContent = "Your ingested repositories will appear here.";
    elements.repoList.appendChild(empty);
    return;
  }

  for (const session of sessions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `repo-item${session.sessionId === activeSession.sessionId ? " is-active" : ""}`;
    button.dataset.sessionId = session.sessionId;

    const name = document.createElement("strong");
    name.textContent = session.repoName || "Unnamed repository";
    const meta = document.createElement("span");
    meta.textContent = session.ready ? `${session.messages.length} messages` : "Ingestion incomplete";
    button.append(name, meta);
    elements.repoList.appendChild(button);
  }
}

function updateHeader() {
  elements.sessionLabel.textContent = formatProjectLabel(activeSession.projectId);
  elements.sessionDetail.textContent = `${formatSessionLabel(activeSession.sessionId)}${activeSession.repoName && activeSession.ready ? ` · ${activeSession.repoName}` : ""}`;
}

function updateFormFromSession() {
  elements.repoUrlInput.value = activeSession.repoUrl || "";
  elements.branchInput.value = activeSession.branch || "";
  elements.setupPanel.classList.toggle("hidden", activeSession.ready);
  elements.chatPanel.classList.toggle("hidden", !activeSession.ready);

  if (activeSession.ready) {
    elements.chatTitle.textContent = activeSession.repoName;
    elements.chatIntro.textContent = `Project ${activeSession.projectId} is ready for source-grounded questions.`;
  }
}

function renderMarkdown(markdown) {
  const source = String(markdown || "");
  const lines = source.split("\n");
  const output = [];
  let inCode = false;
  let language = "";
  let codeLines = [];

  const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
  const inline = (value) => escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  const flushCode = () => {
    const languageClass = language ? ` class="language-${escapeHtml(language)}"` : "";
    output.push(`<div class="code-block"><div class="code-toolbar"><span>${escapeHtml(language || "code")}</span><button class="copy-button" type="button" data-copy-code>Copy</button></div><pre><code${languageClass}>${escapeHtml(codeLines.join("\n"))}</code></pre></div>`);
    codeLines = [];
    language = "";
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) flushCode();
      inCode = !inCode;
      language = line.slice(3).trim();
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) continue;
    if (line.startsWith("### ")) output.push(`<h5>${inline(line.slice(4))}</h5>`);
    else if (line.startsWith("## ")) output.push(`<h4>${inline(line.slice(3))}</h4>`);
    else if (line.startsWith("# ")) output.push(`<h3>${inline(line.slice(2))}</h3>`);
    else if (/^[-*] /.test(line)) output.push(`<div class="markdown-list-item">• ${inline(line.slice(2))}</div>`);
    else output.push(`<p>${inline(line)}</p>`);
  }

  if (inCode) flushCode();
  return output.join("") || "<p></p>";
}

function renderMessages() {
  elements.messageList.replaceChildren();
  elements.chatEmptyState.classList.toggle("hidden", activeSession.messages.length > 0);

  for (const message of activeSession.messages) {
    const article = document.createElement("article");
    article.className = `message message--${message.role}${message.pending ? " message--pending" : ""}${message.interrupted ? " message--interrupted" : ""}`;
    article.dataset.messageId = message.id;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = message.role === "user" ? "You" : message.role === "system" ? "System" : "Assistant";

    const body = document.createElement("div");
    body.className = "message-body";
    if (message.role === "assistant") {
      body.innerHTML = renderMarkdown(message.content);
      if (message.pending) body.insertAdjacentHTML("beforeend", '<span class="typing-cursor" aria-label="Generating"></span>');
    } else {
      body.textContent = message.content;
    }

    article.append(meta, body);
    elements.messageList.appendChild(article);
  }

  elements.messageList.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function appendMessage(role, content, options = {}) {
  activeSession.messages.push({
    id: createId("message"),
    role,
    content,
    pending: Boolean(options.pending),
    interrupted: Boolean(options.interrupted),
    createdAt: new Date().toISOString(),
  });
  updateSession(appState, activeSession.sessionId, { messages: activeSession.messages });
  persist();
  renderMessages();
  return activeSession.messages[activeSession.messages.length - 1];
}

function pendingMessage() {
  return activeSession.messages.find((message) => message.pending);
}

function updatePendingMessage(changes) {
  const message = pendingMessage();
  if (!message) return;
  Object.assign(message, changes);
  updateSession(appState, activeSession.sessionId, { messages: activeSession.messages });
  persist();
  renderMessages();
}

function updateProgress(stage, title) {
  activeStage = Math.min(stage, 3);
  const percent = Math.min(94, Math.round(((activeStage + 1) / 4) * 100));
  elements.progressTitle.textContent = title;
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressBar.style.width = `${percent}%`;
  elements.progressPanel.querySelectorAll("[data-stage]").forEach((item) => {
    const itemStage = Number(item.dataset.stage);
    item.classList.toggle("is-done", itemStage < activeStage);
    item.classList.toggle("is-current", itemStage === activeStage);
  });
}

function startProgress() {
  const stages = [
    [0, "Cloning repository"],
    [1, "Chunking source files"],
    [2, "Generating embeddings"],
    [3, "Indexing knowledge"],
  ];
  let index = 0;
  elements.progressPanel.classList.remove("hidden");
  updateProgress(...stages[0]);
  ingestionTimer = window.setInterval(() => {
    index = Math.min(index + 1, stages.length - 1);
    updateProgress(...stages[index]);
    if (index === stages.length - 1) window.clearInterval(ingestionTimer);
  }, 1800);
}

function stopProgress(success = false) {
  if (ingestionTimer) window.clearInterval(ingestionTimer);
  ingestionTimer = null;
  if (success) {
    elements.progressBar.style.width = "100%";
    elements.progressPercent.textContent = "100%";
    elements.progressTitle.textContent = "Repository ready";
  }
}

function setIngestionLoading(isLoading) {
  elements.repoSubmitButton.disabled = isLoading;
  elements.repoRetryButton.classList.add("hidden");
  if (isLoading) {
    elements.repoStatus.innerHTML = '<span class="spinner"></span>Working through the repository...';
    startProgress();
  } else {
    elements.repoStatus.textContent = "Ready when you are.";
  }
}

function readIngestionOptions() {
  const repoUrl = elements.repoUrlInput.value.trim();
  const chunkSize = Number(elements.chunkSizeInput.value);
  const overlapSize = Number(elements.overlapInput.value);
  const depth = Number(elements.depthInput.value);

  if (!/^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/i.test(repoUrl)) {
    return { error: "Enter a valid public GitHub repository URL." };
  }
  if (!Number.isInteger(chunkSize) || chunkSize < 100) return { error: "Chunk size must be at least 100." };
  if (!Number.isInteger(overlapSize) || overlapSize < 0 || overlapSize >= chunkSize) return { error: "Overlap must be smaller than chunk size." };
  if (!Number.isInteger(depth) || depth < 1) return { error: "Clone depth must be at least 1." };

  return {
    repoUrl,
    branch: elements.branchInput.value.trim(),
    chunkSize,
    overlapSize,
    depth,
    doReset: elements.resetInput.checked,
  };
}

async function ingestRepository() {
  const options = readIngestionOptions();
  setInlineError(elements.repoError, options.error || "");
  if (options.error) return;

  updateSession(appState, activeSession.sessionId, {
    repoUrl: options.repoUrl,
    repoName: deriveRepoDisplayName(options.repoUrl),
    branch: options.branch,
    ready: false,
  });
  activeSession = getActiveSession(appState);
  persist();
  renderRepoList();
  updateHeader();
  setIngestionLoading(true);

  const result = await ingestGitHubRepository(activeSession.projectId, options);
  stopProgress(result.ok);
  setIngestionLoading(false);

  if (!result.ok) {
    setInlineError(elements.repoError, errorMessage(result.error, "Repository ingestion failed."));
    elements.repoRetryButton.classList.remove("hidden");
    showToast(result.error?.message || "Repository ingestion failed.");
    updateConnection(result.error?.type !== "network");
    return;
  }

  updateSession(appState, activeSession.sessionId, { ready: true });
  activeSession = getActiveSession(appState);
  persist();
  updateConnection(true);
  updateFormFromSession();
  renderRepoList();
  updateHeader();
  appendMessage("system", `Repository indexed successfully. Processed ${result.data?.processed_files ?? 0} files and ${result.data?.inserted_chunks ?? 0} chunks.`);
  elements.repoStatus.textContent = "Repository indexed.";
}

async function sendQuestion() {
  if (abortController || !activeSession.ready) return;
  const question = elements.questionInput.value.trim();
  if (!question) {
    setInlineError(elements.questionError, "Enter a question first.");
    return;
  }

  setInlineError(elements.questionError, "");
  elements.questionInput.value = "";
  appendMessage("user", question);
  appendMessage("assistant", "", { pending: true });
  abortController = new AbortController();
  elements.questionSubmitButton.disabled = true;
  elements.stopButton.classList.remove("hidden");
  elements.questionStatus.innerHTML = '<span class="spinner"></span>Generating an answer...';

  const result = await streamRepositoryAnswer(activeSession.projectId, question, {
    signal: abortController.signal,
    onToken: (token) => updatePendingMessage({ content: `${pendingMessage()?.content || ""}${token}` }),
  });

  const partial = result.data?.answer || pendingMessage()?.content || "";
  if (!result.ok && result.error?.type === "stream" && partial) {
    updatePendingMessage({ content: partial, pending: false, interrupted: true });
    setInlineError(elements.questionError, "Generation interrupted. The partial answer is preserved; retry the question.");
    showToast("The answer stream was interrupted.");
  } else if (!result.ok && result.error?.type !== "cancelled") {
    activeSession.messages = activeSession.messages.filter((message) => !message.pending);
    updateSession(appState, activeSession.sessionId, { messages: activeSession.messages });
    persist();
    renderMessages();
    setInlineError(elements.questionError, errorMessage(result.error, "Unable to answer that question."));
    showToast(result.error?.message || "Unable to answer that question.");
    updateConnection(result.error?.type !== "network");
  } else if (result.ok) {
    updatePendingMessage({ content: partial || "No answer was returned.", pending: false });
  } else {
    activeSession.messages = activeSession.messages.filter((message) => !message.pending);
    updateSession(appState, activeSession.sessionId, { messages: activeSession.messages });
    persist();
    renderMessages();
  }

  abortController = null;
  elements.questionSubmitButton.disabled = false;
  elements.stopButton.classList.add("hidden");
  elements.questionStatus.textContent = "Answers stay with this repository.";
}

function stopAnswer() {
  abortController?.abort();
}

function startNewSession() {
  activeSession = addSession(appState);
  persist();
  setInlineError(elements.repoError, "");
  setInlineError(elements.questionError, "");
  elements.progressPanel.classList.add("hidden");
  updateFormFromSession();
  renderRepoList();
  updateHeader();
}

function switchSession(sessionId) {
  activeSession = setActiveSession(appState, sessionId);
  persist();
  setInlineError(elements.repoError, "");
  setInlineError(elements.questionError, "");
  updateFormFromSession();
  renderRepoList();
  updateHeader();
  renderMessages();
}

async function hydrateAppInfo() {
  const result = await fetchAppInfo();
  if (result.ok && result.data?.app_version) {
    elements.appSubtitle.textContent = `Repository intelligence, grounded in source · v${result.data.app_version}`;
    updateConnection(true);
  } else {
    updateConnection(false);
  }
}

function bindEvents() {
  elements.repoForm.addEventListener("submit", (event) => {
    event.preventDefault();
    ingestRepository();
  });
  elements.repoRetryButton.addEventListener("click", ingestRepository);
  elements.questionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendQuestion();
  });
  elements.questionInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendQuestion();
    }
  });
  elements.stopButton.addEventListener("click", stopAnswer);
  elements.newSessionButton.addEventListener("click", startNewSession);
  elements.sidebarNewButton.addEventListener("click", startNewSession);
  elements.repoList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-session-id]");
    if (item) switchSession(item.dataset.sessionId);
  });
  elements.messageList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy-code]");
    if (!button) return;
    const code = button.closest(".code-block")?.querySelector("code")?.textContent || "";
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = "Copied";
      window.setTimeout(() => { button.textContent = "Copy"; }, 1600);
    } catch {
      showToast("Clipboard access is unavailable in this browser.");
    }
  });
  window.addEventListener("online", () => updateConnection(true));
  window.addEventListener("offline", () => updateConnection(false));
}

function bootstrap() {
  bindEvents();
  updateFormFromSession();
  updateHeader();
  renderRepoList();
  renderMessages();
  hydrateAppInfo();
}

bootstrap();
