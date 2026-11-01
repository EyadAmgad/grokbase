/**
 * Backend dtype-mapped client for repository ingestion.
 *
 * Endpoints (existing contracts — src/routes/github.py, data.py, nlp.py):
 *   POST /api/v1/github/process/{project_id}      → sync Git repo ingest
 *   POST /api/v1/data/upload/{project_id}         → multipart file upload
 *   POST /api/v1/data/process-and-push/{project_id} → celery chain (chunk+index)
 *   GET  /api/v1/nlp/index/info/{project_id}      → vector collection info
 *
 * Request conventions match the chat adapter (lib/adapter/restAdapter.ts):
 * JSON bodies, cookie-credentials included, HTML-safe status classification.
 */

/** Wire shapes mapped straight from the backend responses. */

interface GithubProcessResponse {
  signal: string;
  repo_path?: string;
  inserted_chunks?: number;
  processed_files?: number;
}

interface UploadResponse {
  signal?: string;
  /** Some FastAPI versions return `file_id` via JSONResponse content. */
  file_id?: string;
  error?: string;
  detail?: string;
}

interface WorkflowResponse {
  signal?: string;
  workflow_task_id?: string;
  workflow_id?: string;
  error?: string;
  detail?: string;
}

interface IndexInfoResponse {
  signal?: string;
  collection_info?: {
    points_count?: number;
    vectors_count?: number | null;
    status?: unknown;
    [key: string]: unknown;
  };
  detail?: string;
}

export interface IndexProgress {
  phase: "uploading" | "processing" | "success" | "error";
  /** 0–1 when determinable; uploads report file-level progress. */
  progress: number | null;
  message: string;
  insertedChunks?: number;
}

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestError";
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** POST /api/v1/github/process/{project_id} — clones + indexes the repo. */
export async function ingestGitRepository(
  projectId: number,
  options: { repoUrl: string; branch?: string | null; doReset?: boolean },
): Promise<{ insertedChunks: number; processedFiles: number }> {
  const response = await fetch(`/api/v1/github/process/${projectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      repo_url: options.repoUrl,
      branch: options.branch?.trim() || null,
      chunk_size: 1000,
      overlap_size: 200,
      depth: 1,
      do_reset: options.doReset ? 1 : 0,
    }),
  });

  const data = (await readJson(response)) as GithubProcessResponse | null;
  if (!response.ok) {
    throw new IngestError(data?.signal || `Ingestion failed (${response.status}).`);
  }
  if ((data?.inserted_chunks ?? 0) === 0) {
    throw new IngestError("No indexable source files found in that repository.");
  }
  return {
    insertedChunks: data?.inserted_chunks ?? 0,
    processedFiles: data?.processed_files ?? 0,
  };
}

/** POST /api/v1/data/upload/{project_id} — multipart upload, returns file id. */
export async function uploadArchive(
  projectId: number,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<string> {
  const form = new FormData();
  form.append("file", file, file.name);

  // fetch cannot observe upload progress — use XMLHttpRequest like a classic
  // SDK wrapper would; conventions (endpoint, response shape) stay identical.
  const file_id = await new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/v1/data/upload/${projectId}`);
    request.responseType = "json";

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };

    request.onerror = () => reject(new IngestError("The server could not be reached. Check your connection."));
    request.onload = () => {
      const data = (request.response ?? {}) as UploadResponse;
      if (request.status >= 200 && request.status < 300 && data.file_id) {
        resolve(data.file_id);
        return;
      }
      if (request.status === 400) {
        // 400 signal covers size/type validation from validate_uploaded_file.
        reject(new IngestError(data.signal || data.detail || `Upload failed (${request.status}).`));
        return;
      }
      reject(new IngestError(`Upload failed (${request.status}).`));
    };

    request.send(form);
  });
  return file_id;
}

/** POST /api/v1/data/process-and-push/{project_id} — celery chain: chunk+index. */
export async function processAndPush(
  projectId: number,
  fileId: string,
  doReset: boolean,
): Promise<string> {
  const response = await fetch(`/api/v1/data/process-and-push/${projectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      file_id: fileId,
      chunk_size: 1000,
      overlap_size: 200,
      do_reset: doReset ? 1 : 0,
    }),
  });

  const data = (await readJson(response)) as WorkflowResponse | null;
  if (!response.ok || !(data?.workflow_id || data?.workflow_task_id)) {
    throw new IngestError(data?.signal || data?.detail || `Processing failed (${response.status}).`);
  }
  return data.workflow_task_id || data.workflow_id || "workflow";
}

/** GET /api/v1/nlp/index/info/{project_id} — current indexed vector count. */
export async function fetchIndexPoints(projectId: number): Promise<number> {
  const response = await fetch(`/api/v1/nlp/index/info/${projectId}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "include",
  });

  const data = (await readJson(response)) as IndexInfoResponse | null;
  if (!response.ok) return 0;
  return data?.collection_info?.points_count ?? 0;
}

export interface LocalIngestOptions {
  file: File;
  doReset: boolean;
  onProgress: (progress: IndexProgress) => void;
}

/**
 * Full local-archive pipeline: upload (observable progress) → chunk+push
 * celery chain → poll the vector index until the run is visible. The chain
 * response carries only a task id (no completion endpoint exists), so polling
 * `points_count` growth on /nlp/index/info is the existing, honest readiness
 * signal.
 */
export async function ingestLocalArchive(
  projectId: number,
  { file, doReset, onProgress }: LocalIngestOptions,
): Promise<IndexProgress> {
  onProgress({ phase: "processing", progress: 0, message: "Uploading archive…" });

  const fileId = await uploadArchive(projectId, file, (progress) => {
    onProgress({
      phase: "processing",
      progress,
      message: `Uploading archive… ${Math.round(progress * 100)}%`,
    });
  });

  onProgress({ phase: "processing", progress: null, message: "Parsing AST & generating vector embeddings…" });
  const baseline = await fetchIndexPoints(projectId);
  await processAndPush(projectId, fileId, doReset);

  // Poll for indexed points.
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 2_500));
    const points = await fetchIndexPoints(projectId);
    if (points > baseline) {
      const result: IndexProgress = {
        phase: "success",
        progress: 1,
        message: "Index ready",
        insertedChunks: points,
      };
      onProgress(result);
      return result;
    }
  }

  const result: IndexProgress = {
    phase: "error",
    progress: null,
    message: "Indexing is taking longer than expected. It will appear automatically — try again shortly.",
  };
  onProgress(result);
  return result;
}
