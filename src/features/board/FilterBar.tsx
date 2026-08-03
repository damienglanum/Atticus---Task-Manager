import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Bookmark, Filter, Search, Trash2, X } from "lucide-react";

import { Button, IconButton } from "@/components/ui/Button";
import { MenuCheckboxItem, MenuContent, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import type { Column } from "@/lib/bindings/Column";
import type { Label } from "@/lib/bindings/Label";
import type { SavedFilter } from "@/lib/bindings/SavedFilter";
import { cn } from "@/lib/cn";

import { DUE_STATES, type DueState } from "./dates";
import { LabelDot } from "./LabelChip";
import { activeFacetCount, toggle, type BoardFilter } from "./filter";
import { PRIORITIES } from "./priority";

interface FilterBarProps {
  filter: BoardFilter;
  onChange: (filter: BoardFilter) => void;
  columns: Column[];
  labels: Label[];
  savedFilters: SavedFilter[];
  matching: number;
  total: number;
  onSave: () => void;
  onApplySaved: (saved: SavedFilter) => void;
  onDeleteSaved: (saved: SavedFilter) => void;
}

const DUE_LABELS: Record<DueState, string> = {
  overdue: "Overdue",
  today: "Due today",
  soon: "Due soon",
  future: "Due later",
  none: "No due date",
};

/**
 * The board's filter controls.
 *
 * Active filtering is stated in words and a count — "3 of 24 tasks", not a
 * subtly different shade of button — because a board that is quietly hiding work
 * is the single most confusing state this application can be in.
 */
export function FilterBar({
  filter,
  onChange,
  columns,
  labels,
  savedFilters,
  matching,
  total,
  onSave,
  onApplySaved,
  onDeleteSaved,
}: FilterBarProps) {
  const facets = activeFacetCount(filter);
  const filtering = facets > 0;

  // `px-6` matches the compact board toolbar and the columns below. Keeping the
  // filter strip as the toolbar's second rule makes the whole header read as
  // one control surface rather than two unrelated bands.
  return (
    <div className="border-border-subtle bg-surface-app flex items-center gap-1.5 border-y px-6 py-2">
      <div className="border-border-default focus-within:border-accent-border focus-within:outline-focus-ring focus-within:outline-2 focus-within:outline-offset-2 flex w-44 min-w-0 items-center gap-2 rounded-sm border px-2.5 py-0.5">
        <Search size={12} aria-hidden className="text-fg-secondary shrink-0" />
        <input
          type="text"
          aria-label="Filter tasks on this board"
          placeholder="Filter…"
          value={filter.text}
          onChange={(event) => {
            onChange({ ...filter, text: event.target.value });
          }}
          // `h-6` rather than letting the line height decide: the field is the
          // target, and it laid out at 18 px tall, under the 24 px SC 2.5.8 asks
          // for. Measured by `accessibility.e2e.ts`, which is the only layer
          // that can see a laid-out box at all.
          className="text-fg-primary placeholder:text-fg-secondary h-6 min-w-0 flex-1 bg-transparent text-xs outline-none"
          size={12}
        />
      </div>

      <FacetMenu
        name="Column"
        chosen={filter.columnIds.length}
        options={columns.map((column) => ({ id: column.id, label: column.name }))}
        selected={filter.columnIds}
        onToggle={(id) => {
          onChange({ ...filter, columnIds: toggle(filter.columnIds, id) });
        }}
      />

      <FacetMenu
        name="Priority"
        chosen={filter.priorities.length}
        options={PRIORITIES.map((level) => ({
          id: String(level.value),
          label: level.label,
        }))}
        selected={filter.priorities.map(String)}
        onToggle={(id) => {
          onChange({ ...filter, priorities: toggle(filter.priorities, Number(id)) });
        }}
      />

      <FacetMenu
        name="Due"
        chosen={filter.due.length}
        options={DUE_STATES.map((state) => ({ id: state, label: DUE_LABELS[state] }))}
        selected={filter.due}
        onToggle={(id) => {
          onChange({ ...filter, due: toggle(filter.due, id as DueState) });
        }}
      />

      {labels.length === 0 ? null : (
        <FacetMenu
          name="Label"
          chosen={filter.labelIds.length}
          options={labels.map((label) => ({
            id: label.id,
            label: label.name,
            dot: label.color,
          }))}
          selected={filter.labelIds}
          onToggle={(id) => {
            onChange({ ...filter, labelIds: toggle(filter.labelIds, id) });
          }}
        />
      )}

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button size="sm">
            <Bookmark size={12} aria-hidden />
            Saved
            {savedFilters.length === 0 ? null : ` (${String(savedFilters.length)})`}
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <MenuContent align="start" className="min-w-56">
            {savedFilters.length === 0 ? (
              <p className="text-fg-secondary px-2 py-1.5 text-xs">
                No saved filters in this project yet.
              </p>
            ) : (
              savedFilters.map((saved) => (
                <div key={saved.id} className="flex items-center">
                  <div className="min-w-0 flex-1">
                    <MenuItem
                      onSelect={() => {
                        onApplySaved(saved);
                      }}
                    >
                      <Filter size={12} aria-hidden />
                      <span className="truncate">{saved.name}</span>
                    </MenuItem>
                  </div>
                  <IconButton
                    label={`Delete the saved filter “${saved.name}”`}
                    onClick={() => {
                      onDeleteSaved(saved);
                    }}
                  >
                    <Trash2 size={11} aria-hidden />
                  </IconButton>
                </div>
              ))
            )}

            <MenuSeparator />
            <MenuItem disabled={!filtering} onSelect={onSave}>
              <Bookmark size={12} aria-hidden />
              {filtering ? "Save the current filter…" : "Nothing to save yet"}
            </MenuItem>
          </MenuContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {filtering ? (
        <>
          <p
            role="status"
            className={cn(
              "ml-auto text-2xs",
              matching === 0 ? "text-warning-fg" : "text-fg-secondary",
            )}
          >
            {matching === 0
              ? `No tasks match — ${String(total)} hidden`
              : `${String(matching)} of ${String(total)} tasks`}
          </p>
          <Button
            size="sm"
            onClick={() => {
              onChange({ text: "", columnIds: [], priorities: [], labelIds: [], due: [] });
            }}
          >
            <X size={12} aria-hidden />
            Clear {facets === 1 ? "filter" : `${String(facets)} filters`}
          </Button>
        </>
      ) : null}
    </div>
  );
}

function FacetMenu({
  name,
  chosen,
  options,
  selected,
  onToggle,
}: {
  name: string;
  chosen: number;
  options: { id: string; label: string; dot?: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          size="sm"
          className={chosen > 0 ? "border-accent-border text-accent-fg" : undefined}
        >
          {name}
          {chosen === 0 ? null : ` (${String(chosen)})`}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <MenuContent align="start">
          {options.map((option) => (
            <MenuCheckboxItem
              key={option.id}
              checked={selected.includes(option.id)}
              onCheckedChange={() => {
                onToggle(option.id);
              }}
            >
              <span
                aria-hidden
                className={cn(
                  "border-border-strong flex size-3 shrink-0 items-center justify-center rounded-xs border",
                  selected.includes(option.id) ? "bg-accent-bg border-accent-border" : "",
                )}
              >
                {selected.includes(option.id) ? "✓" : ""}
              </span>
              {option.dot === undefined ? null : <LabelDot color={option.dot} />}
              <span className="truncate">{option.label}</span>
            </MenuCheckboxItem>
          ))}
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
