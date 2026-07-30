import { Check } from "lucide-react";

import { cn } from "@/lib/cn";
import { PROJECT_COLORS, type ProjectColor } from "@/lib/schemas";
import { colorVariable } from "./colors";

export function ProjectDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: colorVariable(color) }}
    />
  );
}

interface ColorPickerProps {
  value: ProjectColor;
  onChange: (color: ProjectColor) => void;
}

/**
 * A radio group, not a row of buttons: arrow keys move between swatches and the
 * selection is announced. Each swatch carries its colour **name** as its
 * accessible name, so the control is usable without seeing colour at all — and
 * the selected one shows a check mark, not just a ring.
 */
export function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="text-fg-secondary mb-1 block text-xs font-medium">Colour</legend>
      <div className="flex flex-wrap gap-1">
        {PROJECT_COLORS.map((color) => {
          const selected = color === value;
          return (
            <label
              key={color}
              className={cn(
                "relative inline-flex size-6 cursor-default items-center justify-center rounded-md",
                "focus-within:outline-focus-ring focus-within:outline-2 focus-within:outline-offset-1",
                selected ? "ring-border-strong ring-2" : "hover:ring-border-default hover:ring-1",
              )}
            >
              <input
                type="radio"
                name="project-color"
                value={color}
                checked={selected}
                onChange={() => {
                  onChange(color);
                }}
                className="sr-only"
              />
              <span className="sr-only">{color}</span>
              <span
                aria-hidden
                className="flex size-4 items-center justify-center rounded-full"
                style={{ backgroundColor: colorVariable(color) }}
              >
                {selected ? <Check size={10} strokeWidth={3} className="text-white" /> : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
