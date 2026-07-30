import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CornerDownLeft, Filter, Search, Settings, Undo2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Dialog } from "@/components/ui/Dialog";
import type { SearchHit } from "@/lib/bindings/SearchHit";
import { messageFor } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";
import { cn } from "@/lib/cn";

/** An action the palette can run. */
export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  icon: "filter" | "settings" | "undo" | "project";
  run: () => void;
}

interface CommandPaletteProps {
  commands: PaletteCommand[];
  onOpenTask: (hit: SearchHit) => void;
  onOpenChange: (open: boolean) => void;
}

const ICONS = {
  filter: Filter,
  settings: Settings,
  undo: Undo2,
  project: ArrowRight,
} as const;

/**
 * `⌘K`. Search every project, and run the handful of actions worth reaching
 * without the mouse.
 *
 * Built directly on the W3C APG combobox-with-listbox pattern rather than with
 * `cmdk`, which was the planned dependency. `cmdk`'s substantial contribution is
 * its own fuzzy filtering, and this palette does not filter — the search is
 * FTS5, in SQLite, ranked by `bm25`. What would have been left is roving focus
 * and a few ARIA attributes, which is less code than the integration.
 */
export function CommandPalette({ commands, onOpenTask, onOpenChange }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim();

  const results = useQuery({
    queryKey: queryKeys.search(trimmed),
    queryFn: () => ipc.tasksSearch(trimmed),
    enabled: trimmed.length > 0,
    // A palette is transient; a stale hit list would show work that has since
    // moved or been renamed.
    staleTime: 0,
  });

  const shownCommands =
    trimmed === ""
      ? commands
      : commands.filter((command) => command.label.toLowerCase().includes(trimmed.toLowerCase()));
  const hits = trimmed === "" ? [] : (results.data ?? []);
  const total = shownCommands.length + hits.length;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The highlight goes back to the top whenever the list changes underneath it,
  // so Enter can never run something the user cannot see. Adjusted during
  // render rather than in an effect: React documents this pattern, and an
  // effect would let one frame paint with the highlight on the wrong row.
  const listKey = `${trimmed}|${String(shownCommands.length)}|${String(hits.length)}`;
  const [lastListKey, setLastListKey] = useState(listKey);
  if (listKey !== lastListKey) {
    setLastListKey(listKey);
    setActive(0);
  }

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${String(active)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(index: number) {
    if (index < shownCommands.length) {
      shownCommands[index]?.run();
    } else {
      const hit = hits[index - shownCommands.length];
      if (hit !== undefined) onOpenTask(hit);
    }
    onOpenChange(false);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (total === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current + 1) % total);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current - 1 + total) % total);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(total - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange} title="Search and commands">
      <div className="space-y-3">
        <div className="border-border-default focus-within:border-accent-border flex items-center gap-2 rounded-md border px-2">
          <Search size={14} aria-hidden className="text-fg-tertiary shrink-0" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={total > 0}
            aria-controls={listId}
            aria-activedescendant={total > 0 ? `${listId}-${String(active)}` : undefined}
            aria-autocomplete="list"
            aria-label="Search tasks and commands"
            placeholder="Search tasks, or type a command…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={handleKeyDown}
            className="text-fg-primary placeholder:text-fg-tertiary min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
          />
        </div>

        <div
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label="Results"
          className="max-h-80 overflow-y-auto"
        >
          {shownCommands.map((command, index) => {
            const Icon = ICONS[command.icon];
            return (
              <Row
                key={command.id}
                id={`${listId}-${String(index)}`}
                index={index}
                selected={index === active}
                onHover={setActive}
                onSelect={choose}
              >
                <Icon size={13} aria-hidden className="text-fg-tertiary shrink-0" />
                <span className="text-fg-primary flex-1 truncate">{command.label}</span>
                {command.hint === undefined ? null : (
                  <span className="text-fg-tertiary shrink-0 text-2xs">{command.hint}</span>
                )}
              </Row>
            );
          })}

          {hits.map((hit, offset) => {
            const index = shownCommands.length + offset;
            return (
              <Row
                key={hit.taskId}
                id={`${listId}-${String(index)}`}
                index={index}
                selected={index === active}
                onHover={setActive}
                onSelect={choose}
              >
                <span className="text-fg-tertiary shrink-0 font-mono text-2xs" data-numeric>
                  {hit.projectKeyPrefix}-{hit.number}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-fg-primary block truncate">{hit.title}</span>
                  <span className="text-fg-tertiary block truncate text-2xs">
                    {hit.projectName} · {hit.boardName} · {hit.columnName}
                    {hit.archived ? " · archived" : ""}
                    {hit.excerpt === "" ? "" : ` — ${hit.excerpt}`}
                  </span>
                </span>
              </Row>
            );
          })}
        </div>

        <p role="status" className="text-fg-tertiary flex items-center gap-1.5 text-2xs">
          {results.isError ? (
            <span className="text-danger-fg">{messageFor(results.error)}</span>
          ) : trimmed === "" ? (
            <>
              <CornerDownLeft size={11} aria-hidden />
              Type to search every project.
            </>
          ) : results.isPending ? (
            "Searching…"
          ) : total === 0 ? (
            `Nothing matches “${trimmed}”.`
          ) : (
            `${String(total)} result${total === 1 ? "" : "s"}. Arrow keys to move, Enter to open.`
          )}
        </p>
      </div>
    </Dialog>
  );
}

function Row({
  id,
  index,
  selected,
  onHover,
  onSelect,
  children,
}: {
  id: string;
  index: number;
  selected: boolean;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
  children: React.ReactNode;
}) {
  // A `button` carrying `role="option"`. The listbox owns keyboard handling
  // through `aria-activedescendant` on the input, so an option is only ever a
  // pointer target — but making it a real button rather than a `div` keeps it
  // genuinely activatable rather than a click handler on inert markup.
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={selected}
      // Focusable but not tabbable. The APG combobox pattern keeps focus on the
      // input and points at the active option with `aria-activedescendant`, so
      // putting options in the tab order would break the very thing that makes
      // the pattern work.
      tabIndex={-1}
      data-index={index}
      onMouseMove={() => {
        onHover(index);
      }}
      onClick={() => {
        onSelect(index);
      }}
      className={cn(
        "flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
        selected ? "bg-surface-sunken" : "",
      )}
    >
      {children}
    </button>
  );
}
