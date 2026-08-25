import {
  askRepositoryQuestion,
  fetchAppInfo,
  ingestGitHubRepository,
} from "./api.js";
import {
  clearStoredState,
  createFreshState,
  deriveRepoDisplayName,
  formatProjectLabel,
  formatSessionLabel,
  loadStoredState,
  saveStoredState,
} from "./state.js";

const state = loadStoredState();

const elements = {
  appSubtitle: document.getElementById("appSubtitle"),
  chatEmptyState: document.getElementById("chatEmptyState"),
  chatIntro: document.getElementById("chatIntro"),
  chatPanel: document.getElementById("chatPanel"),
  messageList: document.getElementById("messageList"),
  newSessionButton: document.getElementById("newSessionButton"),
  questionError: document.getElementById("questionError"),
  questionForm: document.getElementById("questionForm"),
  questionInput: document.getElementById("questionInput"),
  questionStatus: document.getElementById("questionStatus"),
  questionSubmitButton: document.getElementById("questionSubmitButton"),
  repoError: document.getElementById("repoError"),
  repoForm: document.getElementById("repoForm"),
  repoStatus: document.getElementById("repoStatus"),
  repoSubmitButton: document.getElementById("repoSubmitButton"),
  repoUrlInput: document.getElementById("repoUrlInput"),
  sessionDetail: document.getElementById("sessionDetail"),
  sessionLabel: document.getElementById("sessionLabel"),
  setupPanel: document.getElementById("setupPanel"),
};

let appInfoLoaded = false;

function createMessageId() {
  return globalThis.crypto?.randomUUID?.() || `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function persistState() {
  saveStoredState(state);
}

function setRepoError(message) {
  if (!message) {
    elements.repoError.hidden = true;
    elements.repoError.textContent = "";
    return;
  }

  elements.repoError.hidden = false;
  elements.repoError.textContent = message;
}

function setQuestionError(message) {
  if (!message) {
    elements.questionError.hidden = true;
    elements.questionError.textContent = "";
    return;
  }

  elements.questionError.hidden = false;
  elements.questionError.textContent = message;
}

function setRepoLoading(isLoading, statusText = "") {
  elements.repoSubmitButton.disabled = isLoading;
  elements.repoForm.classList.toggle("is-loading", isLoading);
  elements.repoStatus.innerHTML = isLoading ? `<span class="spinner"></span>${statusText || "Processing repository..."}` : statusText;
}

function setQuestionLoading(isLoading, statusText = "") {
  elements.questionSubmitButton.disabled = isLoading;
  elements.questionForm.classList.toggle("is-loading", isLoading);
  elements.questionStatus.innerHTML = isLoading ? `<span class="spinner"></span>${statusText || "Sending question..."}` : statusText;
}

function updateHeader() {
  elements.sessionLabel.textContent = formatProjectLabel(state.projectId);
  elements.sessionDetail.textContent = `${formatSessionLabel(state.sessionId)}${state.repoName ? ` · ${state.repoName}` : ""}`;

  const subtitleParts = ["GitHub repo ingestion and Q&A"];
  if (appInfoLoaded && elements.appSubtitle.dataset.version) {
    subtitleParts.unshift(elements.appSubtitle.dataset.version);
  }

  elements.appSubtitle.textContent = subtitleParts.join(" · ");
}

function updateLayout() {
  const hasRepository = Boolean(state.ready);

  elements.setupPanel.classList.toggle("hidden", hasRepository);
  elements.chatPanel.classList.toggle("hidden", !hasRepository);
  elements.repoUrlInput.value = state.repoUrl || "";

  if (hasRepository) {
    elements.chatIntro.textContent = state.repoName
      ? `Repository ${state.repoName} is ready. Ask questions about its files, structure, or behavior.`
      : "Your repository is ready. Ask questions about its files, structure, or behavior.";
  }
}

function renderMessages() {
  elements.messageList.replaceChildren();

  if (!state.messages.length) {
    elements.chatEmptyState.classList.remove("hidden");
    return;
  }

  elements.chatEmptyState.classList.add("hidden");

  for (const message of state.messages) {
    const messageElement = document.createElement("article");
    messageElement.className = `message message--${message.role}${message.pending ? " message--pending" : ""}`;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = message.role === "user" ? "You" : message.role === "system" ? "System" : "Assistant";

    const body = document.createElement("div");
    body.className = "message-body";
    body.textContent = message.content;

    messageElement.append(meta, body);
    elements.messageList.appendChild(messageElement);
  }

  elements.messageList.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" });
}

function pushMessage(role, content, options = {}) {
  state.messages.push({
    id: createMessageId(),
    role,
    content,
    pending: Boolean(options.pending),
    createdAt: new Date().toISOString(),
  });

  persistState();
  renderMessages();
}

function replacePendingAssistantMessage(content) {
  const pendingIndex = state.messages.findIndex((message) => message.pending);

  if (pendingIndex === -1) {
    pushMessage("assistant", content);
    return;
  }

  state.messages[pendingIndex] = {
    ...state.messages[pendingIndex],
    content,
    pending: false,
  };

  persistState();
  renderMessages();
}

function removePendingAssistantMessage() {
  const filteredMessages = state.messages.filter((message) => !message.pending);
  state.messages.splice(0, state.messages.length, ...filteredMessages);
  persistState();
  renderMessages();
}

function updateRepoContext(repoUrl) {
  state.repoUrl = repoUrl.trim();
  state.repoName = deriveRepoDisplayName(state.repoUrl);
  state.updatedAt = new Date().toISOString();
  persistState();
  updateHeader();
}

function resetSession() {
  clearStoredState();

  const freshState = createFreshState();
  state.sessionId = freshState.sessionId;
  state.projectId = freshState.projectId;
  state.repoUrl = freshState.repoUrl;
  state.repoName = freshState.repoName;
  state.ready = freshState.ready;
  state.messages.splice(0, state.messages.length);
  state.updatedAt = freshState.updatedAt;

  elements.repoUrlInput.value = "";
  setRepoError("");
  setQuestionError("");
  setRepoLoading(false, "Create a session to begin.");
  setQuestionLoading(false, "Responses will appear here.");
  updateHeader();
  updateLayout();
  renderMessages();
}

async function handleRepoSubmit(event) {
  event.preventDefault();

  const repoUrl = elements.repoUrlInput.value.trim();
  if (!repoUrl) {
    setRepoError("Please paste a GitHub repository URL.");
    return;
  }

  setRepoError("");
  updateRepoContext(repoUrl);
  setRepoLoading(true, "Processing repository...");

  try {
    const result = await ingestGitHubRepository(state.projectId, repoUrl);
    state.ready = true;
    state.updatedAt = new Date().toISOString();
    persistState();
    updateHeader();
    updateLayout();
    renderMessages();
    setRepoLoading(false, `Indexed ${result?.inserted_chunks ?? 0} chunks from ${result?.processed_files ?? 0} files.`);
    pushMessage("system", `Repository indexed successfully. ${result?.processed_files ? `Processed ${result.processed_files} files.` : "You can start asking questions now."}`);
  } catch (error) {
    state.ready = false;
    persistState();
    updateLayout();
    setRepoLoading(false, "Create a session to begin.");
    setRepoError(error?.payload?.detail || error?.payload?.signal || error.message || "Repository ingestion failed.");
  }
}

async function handleQuestionSubmit(event) {
  event.preventDefault();

  const question = elements.questionInput.value.trim();
  if (!question) {
    setQuestionError("Enter a question first.");
    return;
  }

  setQuestionError("");
  elements.questionInput.value = "";
  pushMessage("user", question);
  pushMessage("assistant", "Thinking...", { pending: true });
  setQuestionLoading(true, "Generating answer...");

  try {
    const result = await askRepositoryQuestion(state.projectId, question);
    replacePendingAssistantMessage(result?.answer || "No answer was returned.");
    setQuestionLoading(false, "Responses will appear here.");
  } catch (error) {
    removePendingAssistantMessage();
    setQuestionLoading(false, "Responses will appear here.");
    setQuestionError(error?.payload?.detail || error?.payload?.signal || error.message || "Unable to answer that question right now.");
  }
}

async function hydrateAppInfo() {
  try {
    const info = await fetchAppInfo();
    if (info?.app_version) {
      elements.appSubtitle.dataset.version = `v${info.app_version}`;
    }
  } catch {
    // The frontend still works if the welcome endpoint is unavailable.
  }

  appInfoLoaded = true;
  updateHeader();
}

function bindEvents() {
  elements.repoForm.addEventListener("submit", handleRepoSubmit);
  elements.questionForm.addEventListener("submit", handleQuestionSubmit);
  elements.newSessionButton.addEventListener("click", resetSession);
}

function bootstrap() {
  bindEvents();
  updateHeader();
  updateLayout();
  setRepoLoading(false, state.ready ? "Repository ready." : "Create a session to begin.");
  setQuestionLoading(false, "Responses will appear here.");
  renderMessages();
  hydrateAppInfo();
}

bootstrap();