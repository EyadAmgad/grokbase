/**
 * BrandMark — the centered 3D logo illustration for the start state.
 * Pure CSS (layered gradients + highlight), zero image assets, crisp at any
 * display density, and respects `prefers-reduced-motion`.
 */

import { cx } from "../../lib/ui-helpers";

export function BrandMark({ className, size = 96 }: { className?: string; size?: number }) {
  const dimension = { width: size, height: size };

  return (
    <div
      className={cx("relative", className)}
      style={dimension}
      role="img"
      aria-label="GrokBase logo"
    >
      {/* Soft accent glow */}
      <div
        aria-hidden="true"
        className="absolute -inset-6 rounded-full bg-accent/20 blur-2xl"
      />
      {/* Base sphere */}
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-gradient-to-b from-accent to-accent-strong shadow-elevated"
      />
      {/* Top-left highlight for the 3D feel */}
      <div
        aria-hidden="true"
        className="absolute left-[12%] top-[8%] h-[38%] w-[52%] rounded-full bg-white/35 blur-[6px]"
      />
      {/* Inner sparkle glyph */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className="absolute inset-0 m-auto h-1/2 w-1/2 text-white drop-shadow"
      >
        <path
          d="M12 2.5c.6 3.9 2.6 6 6.5 6.6-3.9.6-5.9 2.7-6.5 6.6-.6-3.9-2.6-6-6.5-6.6 3.9-.6 5.9-2.7 6.5-6.6Z"
          fill="currentColor"
        />
        <path
          d="M18.4 14.8c.3 1.9 1.3 3 3.1 3.3-1.8.3-2.8 1.4-3.1 3.3-.3-1.9-1.3-3-3.1-3.3 1.8-.3 2.8-1.4 3.1-3.3Z"
          fill="currentColor"
          opacity="0.85"
        />
      </svg>
      {/* Ground shading */}
      <div
        aria-hidden="true"
        className="absolute inset-x-[8%] bottom-0 h-[16%] rounded-full bg-black/10 blur-sm"
      />
    </div>
  );
}
