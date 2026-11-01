/**
 * Mock adapter — a fully functional, offline simulated backend.
 *
 * Used automatically when no API configuration is present (demo mode), and in
 * tests/storybook. Simulates:
 *   - user resolution
 *   - a short seeded history
 *   - word-by-word streamed answers with realistic latency + abort behavior
 */

import type { ChatMessage, UserProfile } from "../types";
import { AdapterError, type AIChatAdapter } from "./types";

const MOCK_USER: UserProfile = {
  id: "usr_demo_01",
  name: "Eyada",
  email: "eyada@grokbase.dev",
  avatarUrl: null,
};

const SEED_HISTORY: ChatMessage[] = [
  {
    id: "hist_seed_1",
    sender: "assistant",
    content:
      "Your workspace is ready. Ask me anything about your projects, drop in a document, or pick one of the quick actions below.",
    timestamp: Date.now() - 1000 * 60 * 60 * 24,
    status: "complete",
  },
];

const CANNED_REPLIES: Array<{ match: RegExp; reply: (prompt: string) => string }> = [
  {
    match: /\b(copy|ad|email|marketing)\b/i,
    reply: (prompt) =>
      `Here's a first draft based on "${prompt}":\n\n"Ship faster with GrokBase. Upload your codebase once, then ask anything — instant, cited answers from your own repository."\n\nWant a punchier headline variant, a longer body, or a version tuned for LinkedIn?`,
  },
  {
    match: /\b(image|visual|design)\b/i,
    reply: (prompt) =>
      `Image generation brief for "${prompt}":\n\n• Style — modern 3D, soft mint/emerald gradients\n• Composition — centered subject, generous negative space\n• Output — 1024×1024 PNG + transparent logo cutout\n\nDescribe a subject and I'll finalize the generation parameters.`,
  },
  {
    match: /\b(research|summar|search)\b/i,
    reply: (prompt) =>
      `Research outline for "${prompt}":\n\n1. Scoping the topic and identifying authoritative sources\n2. Retrieval — vector search across indexed documents and the open web\n3. Synthesis — a cited summary with key numbers and contradictions\n\nShall I run step 1 and draft the source list first?`,
  },
  {
    match: /\b(article|essay|blog)\b/i,
    reply: (prompt) =>
      `Article skeleton for "${prompt}":\n\n• Hook — open with the reader's pain point\n• Thesis — state the position in one sentence\n• Body — 3 arguments with evidence and counterpoints\n• Close — a concrete next action\n\nSay "draft it" and I'll write the first full pass.`,
  },
  {
    match: /\b(data|analytics|insight|chart)\b/i,
    reply: (prompt) =>
      `Analytics plan for "${prompt}":\n\n• Shape of the data — dimensions vs. measures\n• Questions worth asking — retention, outliers, trends\n• Models — descriptive first, then causal\n\nAttach a CSV or point me at a project and I'll produce the first insight pass.`,
  },
  {
    match: /\b(code|function|script|bug)\b/i,
    reply: (prompt) =>
      `Code solution for "${prompt}":\n\n\`\`\`ts\nasync function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {\n  for (let i = 1; i <= attempts; i++) {\n    try {\n      return await fn();\n    } catch (error) {\n      if (i === attempts) throw error;\n      await new Promise((r) => setTimeout(r, 2 ** i * 100));\n    }\n  }\n  throw new Error("unreachable");\n}\n\`\`\`\n\nHighlights: exponential backoff, typed generics, and the final error is preserved. Want unit tests for it?`,
  },
];

function craftReply(prompt: string): string {
  const hit = CANNED_REPLIES.find((entry) => entry.match.test(prompt));
  if (hit) return hit.reply(prompt);
  return `You asked: "${prompt}"\n\nI'm running in **demo mode** right now (no API configured). Point me at a backend by setting VITE_API_URL — or keep exploring; every part of this workspace is live UI.`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AdapterError("cancelled", "Generation cancelled."));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new AdapterError("cancelled", "Generation cancelled."));
      },
      { once: true },
    );
  });
}

export const mockAdapter: AIChatAdapter = {
  async fetchUser(_config, signal) {
    await sleep(450, signal);
    return { ...MOCK_USER };
  },

  async fetchHistory(_config, signal) {
    await sleep(600, signal);
    return SEED_HISTORY.map((message) => ({ ...message }));
  },

  async streamCompletion(payload, _config, handlers, signal) {
    try {
      await sleep(500, signal);
      const reply = craftReply(payload.message);
      let full = "";
      const words = reply.split(/(?<=\s)/);
      let index = 0;
      for (const word of words) {
        if (signal.aborted) break;
        full += word;
        handlers.onDelta(word);
        index += 1;
        if (index % 3 === 0) await sleep(35, signal);
      }
      if (signal.aborted) {
        handlers.onError(new AdapterError("cancelled", "Generation cancelled."));
        return;
      }
      await sleep(120, signal);
      handlers.onDone(full);
    } catch (error) {
      handlers.onError(error instanceof Error ? error : new AdapterError("unknown", "Generation failed."));
    }
  },
};
