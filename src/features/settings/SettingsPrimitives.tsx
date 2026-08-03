import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

interface SettingsBlockProps {
  marker: string;
  title: string;
  description: string;
  status?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * A ruled settings record rather than a floating card.
 *
 * The marker is intentionally part of the visual hierarchy but hidden from
 * assistive technology: headings already provide the semantic outline, while
 * the numbers make the long settings page easier to scan visually.
 */
export function SettingsBlock({
  marker,
  title,
  description,
  status,
  children,
  className,
}: SettingsBlockProps) {
  return (
    <section className={cn("border-border-subtle border-b py-6", className)}>
      <header className="grid gap-3 sm:grid-cols-[2rem_minmax(0,1fr)]">
        <span
          aria-hidden
          data-numeric
          className="text-fg-secondary pt-0.5 font-mono text-2xs tracking-[0.08em]"
        >
          {marker}
        </span>

        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
            <h3 className="text-fg-primary text-sm font-semibold">{title}</h3>
            {status}
          </div>
          <p className="text-fg-secondary mt-1 max-w-3xl text-xs leading-relaxed">{description}</p>
        </div>
      </header>

      {children === undefined ? null : <div className="mt-5 min-w-0 sm:pl-11">{children}</div>}
    </section>
  );
}

export function SettingsStatus({ children }: { children: ReactNode }) {
  return (
    <span className="text-accent-fg inline-flex shrink-0 items-center gap-2 font-mono text-2xs tracking-[0.05em] uppercase">
      <span aria-hidden className="bg-accent-fg size-1.5 rounded-full" />
      {children}
    </span>
  );
}
