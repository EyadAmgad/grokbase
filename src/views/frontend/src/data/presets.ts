/**
 * Static presentation data: the start-state prompt shortcuts. Repository
 * intelligence handles that the indexed codebase can actually answer.
 */

import type { PromptCard } from "../lib/types";

export const PROMPT_CARDS: PromptCard[] = [
  {
    id: "overview",
    title: "Project overview",
    description: "Explain what this repository does and its main components.",
    icon: "search",
    presetPrompt: "Give me an overview of this project: what it does, its main modules, and how they fit together.",
  },
  {
    id: "architecture",
    title: "Trace the architecture",
    description: "Follow the data flow from entry points to the core logic.",
    icon: "chart",
    presetPrompt: "How does data flow through this codebase, from the entry points to persistence? Trace the main paths.",
  },
  {
    id: "feature",
    title: "Where is a feature implemented",
    description: "Locate a specific behavior across files and modules.",
    icon: "article",
    presetPrompt: "Where is authentication implemented? Show the relevant files and how the flow works.",
  },
  {
    id: "review",
    title: "Summarize recent setup",
    description: "What does the configuration and deployment story look like?",
    icon: "code",
    presetPrompt: "Summarize the repository's configuration, dependencies, and deployment setup.",
  },
  {
    id: "answer",
    title: "Deep code question",
    description: "Ask anything about functions, classes, or edge cases.",
    icon: "image",
    presetPrompt: "Which functions handle error and edge cases, and are there gaps you would flag in a review?",
  },
  {
    id: "onboard",
    title: "Onboard a teammate",
    description: "Get a concise primer a new developer could read in 5 minutes.",
    icon: "pen",
    presetPrompt: "Write a 5-minute onboarding summary for a new developer joining this project.",
  },
];
