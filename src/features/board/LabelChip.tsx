import { colorVariable } from "@/features/projects/colors";
import type { Label } from "@/lib/bindings/Label";
import { cn } from "@/lib/cn";

/**
 * A label as it appears on a card.
 *
 * The name is always rendered, never replaced by its colour (US-14 AC4). The
 * dot is a second signal, not the signal — the same reason priority carries a
 * glyph.
 */
export function LabelChip({ label, className }: { label: Label; className?: string }) {
  return (
    <span
      className={cn(
        "border-border-subtle bg-surface-sunken text-fg-secondary inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-px text-2xs",
        className,
      )}
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
