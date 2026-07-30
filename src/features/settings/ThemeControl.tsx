import type { ThemePreference } from "@/lib/bindings/ThemePreference";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

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
      <div className="border-border-default bg-surface-card inline-flex rounded-md border p-px">
        {OPTIONS.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={[
                "cursor-default rounded-sm px-3 py-1 text-xs transition-colors",
                "focus-within:outline-focus-ring focus-within:outline-2",
                selected
                  ? "bg-accent-bg text-accent-fg font-medium"
                  : "text-fg-secondary hover:text-fg-primary",
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
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
