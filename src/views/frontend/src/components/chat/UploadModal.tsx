/**
 * UploadModal — "New Chat" repository binding dialog.
 *
 * Two input paths map to existing backend contracts:
 *   1. Git repository URL (+ optional PAT / branch) → POST /api/v1/github/process
 *   2. Local archive (.zip) drag-and-drop → upload + process-and-push celery chain
 *
 * Accessibility: role="dialog" aria-modal, ESC / backdrop close (blocked while
 * an ingest is running), Tab focus locking, focus restore on close, body
 * scroll lock while open.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileUp,
  GitBranch,
  Link2,
  LoaderCircle,
  Lock,
  Upload,
  X,
} from "lucide-react";
import {
  IngestError,
  ingestGitRepository,
  ingestLocalArchive,
  type IndexProgress,
} from "../../lib/repo-client";
import {
  buildRepoUrl,
  generateProjectId,
  isValidRepoUrl,
  titleFromRepoUrl,
} from "../../lib/sessions";
import { cx } from "../../lib/ui-helpers";

export interface UploadResult {
  projectId: number;
  title: string;
  source: "github" | "upload";
  repoUrl?: string;
  fileLabel?: string;
  insertedChunks?: number;
}

type Phase = "idle" | "running" | "success" | "error";

const GIT_STAGES = [
  "Cloning repository…",
  "Reading files & chunking source code…",
  "Parsing AST & generating vector embeddings…",
  "Indexing knowledge…",
];

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Called once binding succeeded — parent creates the session and navigates. */
  onStartSession: (result: UploadResult) => void;
}

function ProgressBar({ value, running }: { value: number | null; running: boolean }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1 w-full overflow-hidden rounded-full bg-card"
    >
      <div
        className={cx(
          "h-full rounded-full bg-accent transition-all duration-500",
          running && value === null && "w-1/3 animate-pulse",
        )}
        style={value !== null ? { width: `${Math.min(100, value * 100)}%` } : undefined}
      />
    </div>
  );
}

function StatusArea({ phase, progress }: { phase: Exclude<Phase, "idle"> | Phase; progress: IndexProgress | null }) {
  if (!progress) return null;
  return (
    <div aria-live="polite" className="mt-4 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        {phase === "success" ? (
          <GitBranch aria-hidden="true" className="size-4 text-accent" />
        ) : phase === "error" ? (
          <X aria-hidden="true" className="size-4 text-danger" />
        ) : (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-accent" />
        )}
        <span
          className={cx(
            "truncate",
            phase === "error" ? "text-danger" : "text-muted",
            phase === "success" && "font-medium text-ink",
          )}
        >
          {progress.message}
          {progress.insertedChunks ? ` — ${progress.insertedChunks} chunks indexed` : ""}
        </span>
      </div>
      {phase !== "error" ? <ProgressBar value={progress.progress} running={phase === "running"} /> : null}
    </div>
  );
}

export function UploadModal({ open, onClose, onStartSession }: ModalProps) {
  const [tab, setTab] = useState<"git" | "upload">("git");
  const [repoUrl, setRepoUrl] = useState("");
  const [token, setToken] = useState("");
  const [branch, setBranch] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [gitStage, setGitStage] = useState(0);

  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const stageTimer = useRef<number | null>(null);
  // One project id per modal visit: ingest targets it, the session reuses it.
  const projectIdRef = useRef<number>(generateProjectId());
  const objectUrlRef = useRef<string | null>(null);

  const running = phase === "running";

  const reset = useCallback(() => {
    setPhase("idle");
    setProgress(null);
    setFile(null);
    setDragOver(false);
    setTab("git");
    projectIdRef.current = generateProjectId();
  }, []);

  // ESC close + focus lock + restore + scroll lock.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    const focusable = dialog?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !running) {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const activeItem = document.activeElement;
      if (event.shiftKey && activeItem === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeItem === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      restoreFocusRef.current?.focus();
    };
    // `running` intentionally not re-run: handlers poll the state via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);

  // Rotate descriptive stages while the (single) sync git request runs.
  useEffect(() => {
    if (running && tab === "git") {
      setGitStage(0);
      stageTimer.current = window.setInterval(() => {
        setGitStage((stage) => Math.min(stage + 1, GIT_STAGES.length - 1));
      }, 25_000);
      return () => {
        if (stageTimer.current) window.clearInterval(stageTimer.current);
      };
    }
    return undefined;
  }, [running, tab]);

  // Keep a preview URL usable while the File object lives in state.
  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const finish = (message: string, title: string, source: "github" | "upload", repoUrlValue?: string, fileLabel?: string) => {
    setPhase("success");
    setProgress({ phase: "success", progress: 1, message });
    // Small beat so the success state is perceivable before navigation.
    window.setTimeout(() => {
      onStartSession({
        projectId: projectIdRef.current,
        title,
        source,
        repoUrl: repoUrlValue,
        fileLabel,
      });
      onClose();
      reset();
    }, 700);
  };

  const startGitSession = async () => {
    if (!isValidRepoUrl(repoUrl)) return;
    setPhase("running");
    setProgress({ phase: "processing", progress: null, message: GIT_STAGES[0] ?? "Cloning repository…" });

    try {
      const result = await ingestGitRepository(projectIdRef.current, {
        repoUrl: buildRepoUrl(repoUrl, token),
        branch: branch || null,
        doReset: true,
      });
      finish(
        "Index ready",
        titleFromRepoUrl(repoUrl),
        "github",
        repoUrl.trim(),
        undefined,
      );
      void result;
    } catch (error) {
      setPhase("error");
      setProgress({
        phase: "error",
        progress: null,
        message:
          error instanceof IngestError
            ? error.message
            : "Ingestion failed. Check the repository URL and try again.",
      });
    }
  };

  const startUploadSession = async () => {
    if (!file) return;
    setPhase("running");

    try {
      const result = await ingestLocalArchive(projectIdRef.current, {
        file,
        doReset: true,
        onProgress: setProgress,
      });
      if (result.phase === "success") {
        finish(result.message, file.name.replace(/\.zip$/i, ""), "upload", undefined, file.name);
      } else {
        setPhase("error");
        setProgress(result);
      }
    } catch (error) {
      setPhase("error");
      setProgress({
        phase: "error",
        progress: null,
        message:
          error instanceof IngestError
            ? error.message
            : "Upload failed. Try a smaller archive or check your connection.",
      });
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={() => {
          if (!running) onClose();
        }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-modal-title"
        className="relative z-10 flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-elevated"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6">
          <div>
            <h2 id="upload-modal-title" className="text-lg font-semibold tracking-tight text-ink">
              New Chat
            </h2>
            <p className="mt-1 text-sm text-muted">
              Select a repository to initialize the session — answers are grounded in its indexed source.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            disabled={running}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted outline-offset-2 transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        {/* Tabs */}
        <div role="tablist" aria-label="Repository source" className="mx-5 mt-4 grid grid-cols-2 gap-1 rounded-xl bg-canvas p-1 sm:mx-6">
          {(
            [
              { id: "git", label: "Git Repository", icon: Link2 },
              { id: "upload", label: "Local / ZIP", icon: Upload },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                role="tab"
                type="button"
                aria-selected={active}
                disabled={running}
                onClick={() => setTab(item.id)}
                className={cx(
                  "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium outline-offset-2 transition-colors disabled:opacity-50",
                  active ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {tab === "git" ? (
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted">Repository URL</span>
                <input
                  type="url"
                  value={repoUrl}
                  onChange={(event) => setRepoUrl(event.target.value)}
                  placeholder="https://github.com/owner/repository"
                  disabled={running}
                  autoComplete="url"
                  className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-offset-2 placeholder:text-muted focus:border-transparent"
                />
              </label>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted">Personal Access Token <span className="text-muted/70">optional</span></span>
                  <div className="relative">
                    <Lock aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
                    <input
                      type="password"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      placeholder="ghp_…"
                      disabled={running}
                      autoComplete="off"
                      className="w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-3 text-sm text-ink outline-offset-2 placeholder:text-muted"
                    />
                  </div>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted">Branch <span className="text-muted/70">optional</span></span>
                  <input
                    type="text"
                    value={branch}
                    onChange={(event) => setBranch(event.target.value)}
                    placeholder="main"
                    disabled={running}
                    autoComplete="off"
                    className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-offset-2 placeholder:text-muted"
                  />
                </label>
              </div>

              <p className="text-xs leading-relaxed text-muted">
                Supported hosts: GitHub, GitLab, Bitbucket. The token is used for cloning only and is never stored.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div
                role="button"
                tabIndex={0}
                aria-label={file ? `Selected ${file.name}. Choose another file` : "Choose or drop a ZIP archive"}
                onClick={() => {
                  if (!running) document.getElementById("upload-input")?.click();
                }}
                onKeyDown={(event) => {
                  if (running || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  document.getElementById("upload-input")?.click();
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  if (running) return;
                  const dropped = event.dataTransfer.files?.[0];
                  if (dropped && dropped.name.toLowerCase().endsWith(".zip")) setFile(dropped);
                }}
                className={cx(
                  "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center outline-offset-2 transition-colors",
                  dragOver ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-ink/40",
                )}
              >
                <FileUp aria-hidden="true" className="size-8 text-muted" />
                {file ? (
                  <div>
                    <p className="max-w-full truncate text-sm font-medium text-ink">{file.name}</p>
                    <p className="text-xs text-muted">{(file.size / (1024 * 1024)).toFixed(1)} MB · click to replace</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted">
                    Drop a <span className="font-medium text-ink">.zip</span> archive of your project here, or click to browse
                  </p>
                )}
              </div>
              <input
                id="upload-input"
                type="file"
                accept=".zip"
                className="sr-only"
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  if (selected) setFile(selected);
                  event.target.value = "";
                }}
              />
              <p className="text-xs leading-relaxed text-muted">
                Source files (code, docs, configs) inside the archive are chunked and embedded; binaries are ignored.
              </p>
            </div>
          )}

          <StatusArea phase={phase} progress={progress} />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-line bg-card px-5 py-3.5 sm:px-6">
          {phase !== "running" ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                reset();
              }}
              className="rounded-xl px-3.5 py-2 text-sm font-medium text-muted outline-offset-2 transition-colors hover:bg-hover hover:text-ink"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            disabled={
              running ||
              phase === "success" ||
              (tab === "git" ? !isValidRepoUrl(repoUrl) : !file)
            }
            onClick={() => {
              if (tab === "git") void startGitSession();
              else void startUploadSession();
            }}
            className={cx(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold outline-offset-2 transition-colors",
              phase === "running"
                ? "bg-accent-soft text-accent"
                : "bg-accent text-white hover:bg-accent-strong disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            {phase === "running" ? (
              <>
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                {tab === "git" ? GIT_STAGES[gitStage] : "Processing…"}
              </>
            ) : (
              "Start Session"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
