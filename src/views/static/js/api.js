function classifyError({ response = null, message = "Request failed", cause = null } = {}) {
  if (!response) {
    return {
      type: "network",
      message: message || "The server could not be reached. Check your connection and try again.",
    };
  }

  if (response.status >= 500) {
    return { type: "server", status: response.status, message };
  }

  if (response.status >= 400) {
    return { type: response.status === 422 ? "validation" : "client", status: response.status, message };
  }

  return { type: "unknown", status: response.status, message, cause };
}

async function requestJson(path, options = {}) {
  let response;

  try {
    response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    return { ok: false, data: null, error: classifyError({ message: error.message }) };
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    if (response.ok) {
      return { ok: false, data: null, error: classifyError({ response, message: "The server returned an unreadable response.", cause: error }) };
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      data,
      error: classifyError({
        response,
        message: data?.detail || data?.signal || `Request failed (${response.status}).`,
      }),
    };
  }

  return { ok: true, data, error: null };
}

async function fetchAppInfo() {
  return requestJson("/api/v1/", { method: "GET" });
}

async function ingestGitHubRepository(projectId, options) {
  return requestJson(`/api/v1/github/process/${projectId}`, {
    method: "POST",
    body: JSON.stringify({
      repo_url: options.repoUrl,
      branch: options.branch || null,
      chunk_size: options.chunkSize,
      overlap_size: options.overlapSize,
      depth: options.depth,
      do_reset: options.doReset ? 1 : 0,
    }),
  });
}

async function askRepositoryQuestion(projectId, text, limit = 5, signal) {
  return requestJson(`/api/v1/nlp/index/answer/${projectId}`, {
    method: "POST",
    signal,
    body: JSON.stringify({ text, limit }),
  });
}

function parseStreamEvent(rawEvent) {
  const dataLines = rawEvent.split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  const rawData = dataLines.join("\n").trim();

  if (!rawData) return null;
  if (rawData === "[DONE]") return { done: true };

  try {
    const parsed = JSON.parse(rawData);
    return {
      token: parsed.token ?? parsed.content ?? parsed.text ?? "",
      done: Boolean(parsed.done),
      error: parsed.error || null,
    };
  } catch {
    return { token: rawData, done: false, error: null };
  }
}

async function streamRepositoryAnswer(projectId, text, options = {}) {
  const { limit = 5, signal, onToken = () => {}, onDone = () => {} } = options;
  let response;

  try {
    response = await fetch(`/api/v1/nlp/index/answer/${projectId}`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Accept: "text/event-stream, application/json" },
      body: JSON.stringify({ text, limit }),
    });
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: {
        type: error.name === "AbortError" ? "cancelled" : "network",
        message: error.name === "AbortError" ? "Request cancelled." : error.message,
      },
    };
  }

  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return {
      ok: false,
      data,
      error: classifyError({ response, message: data?.detail || data?.signal || `Request failed (${response.status}).` }),
    };
  }

  if (!response.body || contentType.includes("application/json")) {
    let data;
    try {
      data = await response.json();
    } catch (error) {
      return { ok: false, data: null, error: classifyError({ response, message: "The answer response could not be parsed.", cause: error }) };
    }
    if (data?.answer) onToken(data.answer);
    onDone(data);
    return { ok: true, data, error: null, streamed: false };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const rawEvent of events) {
        const event = parseStreamEvent(rawEvent);
        if (!event) continue;
        if (event.error) throw new Error(event.error);
        if (event.token) {
          answer += event.token;
          onToken(event.token);
        }
        if (event.done) {
          onDone({ answer });
          return { ok: true, data: { answer }, error: null, streamed: true };
        }
      }
    }

    const finalEvent = parseStreamEvent(buffer);
    if (finalEvent?.token) {
      answer += finalEvent.token;
      onToken(finalEvent.token);
    }
    onDone({ answer });
    return { ok: true, data: { answer }, error: null, streamed: true };
  } catch (error) {
    return {
      ok: false,
      data: { answer },
      error: {
        type: signal?.aborted ? "cancelled" : "stream",
        message: signal?.aborted ? "Request cancelled." : "The answer stream was interrupted.",
        cause: error,
      },
    };
  }
}

export {
  askRepositoryQuestion,
  fetchAppInfo,
  ingestGitHubRepository,
  requestJson,
  streamRepositoryAnswer,
};
