import { Check } from "lucide-react";

import type { ColorPalette } from "@/lib/bindings/ColorPalette";
import { cn } from "@/lib/cn";

interface PaletteOption {
  value: ColorPalette;
  label: string;
  tones: string;
  colors: readonly [string, string];
}

const OPTIONS = [
  {
    value: "atticus",
    label: "Atticus original",
    tones: "Cyan · Charcoal",
    colors: ["#00779E", "#1D1E21"],
  },
  {
    value: "green-twilight",
    label: "Green Yellow · Deep Twilight",
    tones: "#B9FA3C · #04045E",
    colors: ["#B9FA3C", "#04045E"],
  },
  {
    value: "wisteria-prussian",
    label: "Wisteria Blue · Prussian Blue",
    tones: "#8FA0D8 · #0C0829",
    colors: ["#8FA0D8", "#0C0829"],
  },
  {
    value: "violet-linen",
    label: "Midnight Violet · Linen",
    tones: "#371931 · #FFF3E5",
    colors: ["#371931", "#FFF3E5"],
  },
  {
    value: "parchment-coral",
    label: "Parchment · Vibrant Coral",
    tones: "#FAF5EF · #EC5E5A",
    colors: ["#FAF5EF", "#EC5E5A"],
  },
  {
    value: "custard-pine",
    label: "Vanilla Custard · Pine Teal",
    tones: "#FFEFB3 · #013E37",
    colors: ["#FFEFB3", "#013E37"],
  },
  {
    value: "laser-gold",
    label: "Laser Blue · Bright Gold",
    tones: "#070D0D · #F0EDE4",
    colors: ["#070D0D", "#F0EDE4"],
  },
] as const satisfies readonly PaletteOption[];

interface PaletteControlProps {
  value: ColorPalette;
  onChange: (palette: ColorPalette) => void;
  busy?: boolean;
}

/** The app-wide colour pair, independent from light/dark mode. */
export function PaletteControl({ value, onChange, busy = false }: PaletteControlProps) {
  return (
    <fieldset className="m-0 border-0 p-0" disabled={busy}>
      <legend className="sr-only">Colour style</legend>
      <div className="grid max-w-3xl gap-2 sm:grid-cols-2">
        {OPTIONS.map((option) => {
          const selected = value === option.value;

          return (
            <label
              key={option.value}
              className={cn(
                "focus-within:outline-focus-ring relative flex min-h-16 cursor-default items-center gap-3 rounded-lg border p-2.5 focus-within:outline-2 focus-within:outline-offset-2",
                "transition-[border-color,background-color] duration-(--duration-fast)",
                selected
                  ? "border-accent-solid bg-accent-bg"
                  : "border-border-subtle bg-surface-app hover:border-border-default hover:bg-surface-sunken",
                busy ? "opacity-60" : "",
              )}
            >
              <input
                type="radio"
                name="color-palette"
                value={option.value}
                checked={selected}
                onChange={() => {
                  onChange(option.value);
                }}
                className="sr-only"
              />

              <span
                aria-hidden
                className="border-border-default flex h-10 w-16 shrink-0 overflow-hidden rounded-md border shadow-(--shadow-xs)"
              >
                <span className="flex-1" style={{ backgroundColor: option.colors[0] }} />
                <span className="flex-1" style={{ backgroundColor: option.colors[1] }} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="text-fg-primary block truncate text-xs font-medium">
                  {option.label}
                </span>
                <span className="text-fg-secondary mt-0.5 block font-mono text-[9px] tracking-[0.04em]">
                  {option.tones}
                </span>
              </span>

              <span
                aria-hidden
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border",
                  selected
                    ? "border-accent-solid bg-accent-solid text-on-accent-solid"
                    : "border-border-default text-transparent",
                )}
              >
                <Check size={11} strokeWidth={2.5} />
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
