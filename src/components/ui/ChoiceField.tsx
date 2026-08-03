import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";

export interface ChoiceOption {
  value: string;
  label: string;
  /** A quiet index is used when the option has no meaningful glyph. */
  index?: string;
  icon?: LucideIcon;
  tone?: string;
}

interface ChoiceFieldProps {
  id: string;
  label: string;
  value: string;
  options: readonly ChoiceOption[];
  onChange: (value: string) => void;
}

/**
 * Atticus's select-like control.
 *
 * The native macOS select menu cannot inherit an application's design tokens,
 * which is why the old field turned blue and glossy as soon as it opened.
 * Radix owns the menu-button mechanics here: focus return, roving keyboard
 * navigation, typeahead, Escape, and `menuitemradio` semantics. This component
 * owns only the survey-sheet presentation.
 */
export function ChoiceField({ id, label, value, options, onChange }: ChoiceFieldProps) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  const SelectedIcon = selected?.icon;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="text-fg-secondary block text-2xs font-semibold tracking-[0.08em] uppercase"
      >
        {label}
      </label>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            id={id}
            type="button"
            aria-label={label}
            className={cn(
              "border-border-default bg-surface-card text-fg-primary grid h-10 w-full cursor-default",
              "grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2.5 text-left text-sm",
              "data-[state=open]:border-accent-border data-[state=open]:bg-surface-raised",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "text-fg-secondary flex size-6 items-center justify-center font-mono text-[9px]",
                SelectedIcon === undefined ? "border-border-subtle border-r" : selected?.tone,
              )}
            >
              {SelectedIcon === undefined ? (
                (selected?.index ?? "—")
              ) : (
                <SelectedIcon size={14} strokeWidth={1.8} />
              )}
            </span>
            <span className="min-w-0 truncate font-medium">{selected?.label ?? value}</span>
            <ChevronDown size={14} aria-hidden className="text-fg-secondary shrink-0" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={5}
            style={{
              zIndex: "var(--z-toast)",
              minWidth: "var(--radix-dropdown-menu-trigger-width)",
            }}
            className="border-border-default bg-surface-raised rounded-md border p-1 shadow-(--shadow-overlay)"
          >
            <DropdownMenu.Label className="border-border-subtle text-fg-secondary border-b px-2 py-1.5 font-mono text-[9px] tracking-[0.12em] uppercase">
              {label} / choose one
            </DropdownMenu.Label>

            <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
              {options.map((option) => {
                const OptionIcon = option.icon;
                return (
                  <DropdownMenu.RadioItem
                    key={option.value}
                    value={option.value}
                    aria-label={option.label}
                    textValue={option.label}
                    className={cn(
                      "text-fg-secondary grid cursor-default grid-cols-[1.5rem_1.25rem_minmax(0,1fr)_1.25rem] items-center gap-1.5 rounded-sm px-2 py-2 text-xs outline-none",
                      "data-[state=checked]:bg-surface-sunken data-[state=checked]:text-fg-primary",
                      "data-highlighted:bg-surface-sunken data-highlighted:text-fg-primary",
                      "data-highlighted:outline-focus-ring data-highlighted:-outline-offset-2 data-highlighted:outline-2 data-highlighted:outline-solid",
                    )}
                  >
                    <span data-numeric className="font-mono text-[9px]">
                      {option.index ?? "·"}
                    </span>
                    <span aria-hidden className={cn("flex items-center", option.tone)}>
                      {OptionIcon === undefined ? (
                        <span className="border-border-strong size-1.5 rounded-full border" />
                      ) : (
                        <OptionIcon size={13} strokeWidth={1.8} />
                      )}
                    </span>
                    <span className="truncate font-medium">{option.label}</span>
                    <DropdownMenu.ItemIndicator className="text-accent-fg flex items-center justify-end">
                      <Check size={13} strokeWidth={2.5} aria-hidden />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                );
              })}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
