import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { IconButton } from "@/components/ui/Button";
import type { Subtask } from "@/lib/bindings/Subtask";

interface SubtaskListProps {
  subtasks: Subtask[];
  onAdd: (title: string) => void;
  onToggle: (subtask: Subtask, done: boolean) => void;
  onRename: (subtask: Subtask, title: string) => void;
  onDelete: (subtask: Subtask) => void;
}

/**
 * The checklist inside a task.
 *
 * Completing every item does nothing to the parent — no automatic move, no
 * automatic archive (US-13 AC3). The count is information, not a trigger.
 */
export function SubtaskList({ subtasks, onAdd, onToggle, onRename, onDelete }: SubtaskListProps) {
  const [draft, setDraft] = useState("");

  const done = subtasks.filter((subtask) => subtask.done).length;

  function submit() {
    const title = draft.trim();
    // Empty is a no-op, as in the quick composer: pressing Enter on an empty box
    // means "nothing more", not "I made a mistake".
    if (title === "") return;
    onAdd(title);
    setDraft("");
  }

  return (
    <section aria-labelledby="subtasks-heading" className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3
          id="subtasks-heading"
          className="text-fg-secondary text-xs font-semibold tracking-[0.06em] uppercase"
        >
          Subtasks
        </h3>
        {subtasks.length > 0 ? (
          <span className="text-fg-tertiary font-mono text-2xs" data-numeric>
            {done}/{subtasks.length}
          </span>
        ) : null}
      </div>

      {subtasks.length > 0 ? (
        <ul className="space-y-0.5">
          {subtasks.map((subtask) => (
            <li key={subtask.id} className="group flex items-center gap-2">
              <input
                type="checkbox"
                id={`subtask-${subtask.id}`}
                checked={subtask.done}
                onChange={(event) => {
                  onToggle(subtask, event.target.checked);
                }}
                className="shrink-0"
              />
              <label htmlFor={`subtask-${subtask.id}`} className="sr-only">
                {subtask.title}
              </label>
              <input
                type="text"
                defaultValue={subtask.title}
                aria-label={`Title of subtask “${subtask.title}”`}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next !== "" && next !== subtask.title) onRename(subtask, next);
                  else event.target.value = subtask.title;
                }}
                className={`text-fg-primary min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs outline-none ${
                  subtask.done ? "text-fg-tertiary line-through" : ""
                }`}
              />
              <IconButton
                label={`Delete subtask “${subtask.title}”`}
                className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => {
                  onDelete(subtask);
                }}
              >
                <Trash2 size={12} aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Plus size={13} aria-hidden className="text-fg-tertiary shrink-0" />
        <input
          type="text"
          value={draft}
          aria-label="New subtask"
          placeholder="Add a subtask"
          maxLength={300}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            // Handled here rather than relying on a form's implicit submission,
            // which needs exactly one field and no submit button to work at all
            // — a rule that is easy to break by adding a second control later.
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          className="text-fg-primary placeholder:text-fg-tertiary min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs outline-none"
        />
      </form>
    </section>
  );
}
