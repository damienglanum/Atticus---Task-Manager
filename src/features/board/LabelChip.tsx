import { colorVariable, labelColorVariable } from "@/features/projects/colors";
import type { Label } from "@/lib/bindings/Label";
import { cn } from "@/lib/cn";

/**
 * A label as it appears on a card.
 *
 * The name is always rendered, never replaced by its colour (US-14 AC4). The
 * dot is a second signal, not the signal — the same reason priority carries a
 * glyph.
 *
 * Set in small caps, which is a typographic choice rather than a change to the
 * text: `text-transform` does not touch the DOM, so the accessible name is the
 * name the user typed, in the case they typed it.
 */
export function LabelChip({ label, className }: { label: Label; className?: string }) {
  return (
    <span
      className={cn(
        "text-fg-secondary inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-0.5",
        "text-2xs font-medium tracking-[0.06em] uppercase",
        className,
      )}
      style={{
        backgroundColor: labelColorVariable(label.color),
        borderColor: colorVariable(label.color),
      }}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: colorVariable(label.color) }}
      />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

/** The coloured dot alone, for a list where the name sits beside it. */
export function LabelDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: colorVariable(color) }}
    />
  );
}
