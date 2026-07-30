import { cn } from "@/lib/cn";

/**
 * The Atticus mark.
 *
 * Drawn here rather than pulled from the icon set. An icon set is a vocabulary
 * for describing actions, and a product's own mark is not one of those — taking
 * it from Lucide would mean the identity changes whenever the set does.
 *
 * The tile is `--color-accent-solid`, which is the one value in the palette
 * measured to carry a white glyph in both themes. That is also why the mark is
 * a deeper cyan than a brand swatch would be; see the note in `tokens.css`.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-accent-solid inline-flex size-7 shrink-0 items-center justify-center rounded-lg",
        className,
      )}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.1" stroke="var(--color-on-solid)" strokeWidth="1.4" />
        <path
          d="M5.3 8.15 7.05 9.9l3.65-4"
          stroke="var(--color-on-solid)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** The mark and the name, as they appear at the top of the sidebar. */
export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-fg-primary text-lg font-semibold tracking-[-0.01em]">Atticus</span>
    </div>
  );
}
