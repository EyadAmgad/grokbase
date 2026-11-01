/**
 * PromptCardGrid — the 2×3 grid of actionable prompt shortcuts.
 *
 * Cards are real <button>s (keyboard operable); activation populates the
 * composer via the provider's `selectPreset` and moves focus into it, so the
 * next stop is natural: review → send.
 */

import { BarChart3, ImagePlus, Newspaper, PenLine, SearchCode, SquareCode } from "lucide-react";
import { useAIChat } from "../../providers/AIChatProvider";
import { PROMPT_CARDS } from "../../data/presets";
import type { PromptCard, PromptIconKey } from "../../lib/types";

/** Serializable icon key → lucide component registry (data stays serializable). */
const ICONS: Record<PromptIconKey, typeof PenLine> = {
  pen: PenLine,
  image: ImagePlus,
  search: SearchCode,
  article: Newspaper,
  chart: BarChart3,
  code: SquareCode,
};

function PromptCardItem({ card }: { card: PromptCard }) {
  const { selectPreset } = useAIChat();
  const Icon = ICONS[card.icon];

  return (
    <button
      type="button"
      onClick={() => selectPreset(card.presetPrompt)}
      className="group flex flex-col items-start gap-2.5 rounded-2xl border border-line bg-surface p-4 text-left shadow-card outline-offset-2 transition-all duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-elevated focus-visible:-translate-y-0.5 sm:p-5"
    >
      <span
        aria-hidden="true"
        className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-strong transition-colors group-hover:bg-accent group-hover:text-white"
      >
        <Icon className="size-5" />
      </span>
      <span className="text-sm font-semibold text-ink sm:text-[15px]">{card.title}</span>
      <span className="text-xs leading-relaxed text-muted sm:text-[13px]">{card.description}</span>
    </button>
  );
}

/** Fallback while prompt data would be loading (kept for backend flexibility). */
function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 sm:gap-4" aria-hidden="true">
      {Array.from({ length: PROMPT_CARDS.length }, (_, index) => (
        <div key={index} className="h-[132px] animate-pulse rounded-2xl border border-line bg-surface/60" />
      ))}
    </div>
  );
}

export function PromptCardGrid({ loaded = true }: { loaded?: boolean }) {
  if (!loaded) return <GridSkeleton />;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 sm:gap-4">
      {PROMPT_CARDS.map((card) => (
        <PromptCardItem key={card.id} card={card} />
      ))}
    </div>
  );
}
