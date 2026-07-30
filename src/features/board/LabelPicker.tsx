import { Check, Plus, Tag } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import type { Label } from "@/lib/bindings/Label";
import { colorVariable } from "@/features/projects/colors";
import { PROJECT_COLORS } from "@/lib/schemas";
import { cn } from "@/lib/cn";

import { LabelDot } from "./LabelChip";

interface LabelPickerProps {
  available: Label[];
  selected: string[];
  onChange: (labelIds: string[]) => void;
  onCreate: (name: string, color: string) => void;
  creating: boolean;
}

/**
 * Choosing which labels a task carries.
 *
 * Checkboxes rather than a combobox: a project has a handful of labels, the set
 * is the thing being edited, and a list of checkboxes is operable from the
 * keyboard with no custom interaction to learn or to get wrong.
 *
 * Colour is never the only carrier of meaning — every label shows its name
 * (US-14 AC4).
 */
export function LabelPicker({
  available,
  selected,
  onChange,
  onCreate,
  creating,
}: LabelPickerProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PROJECT_COLORS[1]);

  // Focus moved deliberately, once, when the form appears — rather than
  // `autoFocus`, which fires whenever React decides to mount the node and is
  // why the rule against it exists.
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (adding) nameRef.current?.focus();
  }, [adding]);

  function toggle(labelId: string, on: boolean) {
    onChange(on ? [...selected, labelId] : selected.filter((each) => each !== labelId));
  }

  return (
    <section aria-labelledby="labels-heading" className="space-y-2">
      <h3
        id="labels-heading"
        className="text-fg-secondary text-xs font-semibold tracking-[0.06em] uppercase"
      >
        Labels
      </h3>

      {available.length === 0 && !adding ? (
        <p className="text-fg-secondary text-xs">This project has no labels yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {available.map((label) => {
            const checked = selected.includes(label.id);
            return (
              <li key={label.id}>
                <label className="hover:bg-surface-sunken flex cursor-default items-center gap-2 rounded-sm px-1 py-1">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      toggle(label.id, event.target.checked);
                    }}
                  />
                  <LabelDot color={label.color} />
                  <span className="text-fg-primary min-w-0 flex-1 truncate text-xs">
                    {label.name}
                  </span>
                  {checked ? <Check size={12} aria-hidden className="text-accent-fg" /> : null}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <form
          className="space-y-2 pt-1"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (trimmed === "") return;
            onCreate(trimmed, color);
            setName("");
            setAdding(false);
          }}
        >
          <input
            type="text"
            value={name}
            aria-label="New label name"
            placeholder="Label name"
            ref={nameRef}
            maxLength={40}
            onChange={(event) => {
              setName(event.target.value);
            }}
            className="border-border-strong bg-surface-raised text-fg-primary w-full rounded-md border px-2 py-1 text-xs"
          />

          <fieldset className="flex flex-wrap gap-1">
            <legend className="sr-only">Label colour</legend>
            {PROJECT_COLORS.map((option) => (
              <label key={option} className="cursor-default">
                <input
                  type="radio"
                  name="label-color"
                  value={option}
                  checked={color === option}
                  onChange={() => {
                    setColor(option);
                  }}
                  className="peer sr-only"
                />
                <span
                  title={option}
                  style={{ backgroundColor: colorVariable(option) }}
                  className={cn(
                    "peer-focus-visible:ring-accent-border block size-4 rounded-full border peer-focus-visible:ring-2",
                    color === option ? "border-fg-primary" : "border-transparent",
                  )}
                />
                <span className="sr-only">{option}</span>
              </label>
            ))}
          </fieldset>

          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={creating}>
              {creating ? "Adding…" : "Add label"}
            </Button>
            <Button
              onClick={() => {
                setAdding(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
          }}
          className="text-fg-secondary hover:text-fg-primary flex cursor-default items-center gap-1.5 text-xs"
        >
          <Plus size={12} aria-hidden />
          New label
        </button>
      )}

      {selected.length === 0 ? null : (
        <p className="text-fg-secondary flex items-center gap-1 pt-1 text-2xs">
          <Tag size={11} aria-hidden />
          {selected.length} on this task
        </p>
      )}
    </section>
  );
}
