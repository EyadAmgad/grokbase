async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.detail || payload?.signal || `Request failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function fetchAppInfo() {
  return requestJson("/api/v1/", {
    method: "GET",
  });
}

async function ingestGitHubRepository(projectId, repoUrl) {
  return requestJson(`/api/v1/github/process/${projectId}`, {
    method: "POST",
    body: JSON.stringify({
      repo_url: repoUrl,
    }),
  });
}

async function askRepositoryQuestion(projectId, text, limit = 5) {
  return requestJson(`/api/v1/nlp/index/answer/${projectId}`, {
    method: "POST",
    body: JSON.stringify({
      text,
      limit,
    }),
  });
}

export {
  askRepositoryQuestion,
  fetchAppInfo,
  ingestGitHubRepository,
};