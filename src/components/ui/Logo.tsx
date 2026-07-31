import { cn } from "@/lib/cn";

import { CONTOURS, markGeometry } from "./logoContours";

interface LogoMarkProps {
  /** Rendered size in CSS pixels. Decides how much of the contour map survives. */
  size?: number;
  className?: string;
}

/**
 * The Atticus mark.
 *
 * A contour map rather than a glyph, and drawn in line rather than filled, so
 * it takes its colour from whatever it is sitting in. `currentColor` and no
 * background: the previous mark was a solid accent tile, which needed its own
 * contrast argument for the glyph inside it. Linework has no inside.
 *
 * It sheds rings as it shrinks — see `contoursForSize` for why that is not
 * cheating.
 */
export function LogoMark({ size = 28, className }: LogoMarkProps) {
  const { rings, viewBox, strokeWidth } = markGeometry(size);

  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      className={cn("shrink-0", className)}
    >
      <g
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {CONTOURS.slice(0, rings).map((d, index) => (
          <path key={index} d={d} />
        ))}
      </g>
    </svg>
  );
}

/**
 * The mark and the name, as they appear at the top of the sidebar.
 *
 * The mark carries the accent; the word does not. Two coloured things beside
 * each other at this size read as one smudge of colour rather than as a mark
 * and a name.
 */
export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={26} className="text-accent-fg" />
      <span className="text-fg-primary text-lg font-semibold tracking-[-0.01em]">Atticus</span>
    </div>
  );
}
