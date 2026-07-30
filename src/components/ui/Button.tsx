import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent-solid text-white border-transparent hover:opacity-90",
  secondary: "bg-surface-card text-fg-primary border-border-default hover:border-border-strong",
  ghost: "bg-transparent text-fg-secondary border-transparent hover:bg-surface-sunken",
  danger: "bg-danger-solid text-white border-transparent hover:opacity-90",
};

const SIZES: Record<Size, string> = {
  // 24px is the WCAG 2.2 minimum target size; 32px for anything primary.
  sm: "h-6 px-2 text-2xs gap-1",
  md: "h-8 px-3 text-xs gap-1.5",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      // Explicit: a bare <button> inside a form submits it, which has caused
      // more accidental submissions than it has ever saved keystrokes.
      type={type}
      className={cn(
        "inline-flex cursor-default items-center justify-center rounded-md border font-medium",
        "transition-colors duration-(--duration-fast)",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: an icon with no name is invisible to assistive technology. */
  label: string;
  children: ReactNode;
  /**
   * React 19 passes `ref` as an ordinary prop to function components, but
   * `ButtonHTMLAttributes` does not declare it, so it is declared here. Needed
   * by callers that restore focus to the button after closing something.
   */
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ label, className, children, ref, ...rest }: IconButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "text-fg-secondary hover:text-fg-primary hover:bg-surface-sunken",
        "inline-flex size-6 cursor-default items-center justify-center rounded-md",
        "transition-colors duration-(--duration-fast)",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
