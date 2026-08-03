import { Monitor, Moon, Sun } from "lucide-react";

import type { ThemePreference } from "@/lib/bindings/ThemePreference";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] satisfies { value: ThemePreference; label: string; icon: typeof Sun }[];

interface ThemeControlProps {
  value: ThemePreference;
  onChange: (preference: ThemePreference) => void;
  busy?: boolean;
}

/**
 * A three-way segmented control.
 *
 * Built as a real radio group rather than styled buttons: arrow keys move
 * between options, only the selected option is in the tab order, and screen
 * readers announce "2 of 3" without any ARIA of our own. Native radios do all
 * of that; a div with `role="radiogroup"` would mean reimplementing it.
 */
export function ThemeControl({ value, onChange, busy = false }: ThemeControlProps) {
  return (
    <fieldset className="m-0 border-0 p-0" disabled={busy}>
      <legend className="sr-only">Theme</legend>
      <div className="border-border-default divide-border-subtle inline-grid w-full max-w-lg grid-cols-3 overflow-hidden rounded-md border divide-x">
        {OPTIONS.map((option) => {
          const selected = option.value === value;
          const Icon = option.icon;
          return (
            <label
              key={option.value}
              className={[
                "relative flex min-h-10 cursor-default items-center justify-center gap-2 px-3 py-2 text-xs transition-colors",
                "focus-within:outline-focus-ring focus-within:outline-2",
                selected
                  ? "bg-surface-sunken text-fg-primary font-medium"
                  : "bg-surface-app text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
                busy ? "opacity-60" : "",
              ].join(" ")}
            >
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={selected}
                onChange={() => {
                  onChange(option.value);
                }}
                className="sr-only"
              />
              <Icon
                size={14}
                strokeWidth={1.75}
                aria-hidden
                className={selected ? "text-accent-fg" : undefined}
              />
              {option.label}
              {selected ? (
                <span aria-hidden className="bg-accent-solid absolute inset-x-2 bottom-0 h-0.5" />
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
