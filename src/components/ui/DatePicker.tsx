import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { cn } from "@/lib/cn";

interface DatePickerProps {
  id: string;
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  description: string;
  descriptionClassName?: string;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = Array.from({ length: 7 }, (_, index) => {
  const date = new Date(Date.UTC(2024, 0, 1 + index)); // Monday first.
  return {
    short: new Intl.DateTimeFormat(undefined, { weekday: "narrow", timeZone: "UTC" }).format(date),
    long: new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: "UTC" }).format(date),
  };
});

function todayIso(): string {
  const now = new Date();
  return [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseIso(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return parseIso(todayIso());
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function toIso(date: Date): string {
  return [
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getTime() + amount * DAY_MS);
}

function addMonths(date: Date, amount: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
  const finalDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), finalDay));
  return target;
}

function mondayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

function calendarDays(month: Date): Date[] {
  const first = monthStart(month);
  const start = addDays(first, -mondayIndex(first));
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function formatDate(date: Date, full = false): string {
  return new Intl.DateTimeFormat(
    undefined,
    full
      ? { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
      : { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" },
  ).format(date);
}

/**
 * An ISO calendar-date picker that never passes through local midnight.
 *
 * Radix Popover supplies anchored positioning, collision handling, Escape,
 * outside dismissal, and focus restoration. The grid remains Atticus code so
 * dates stay `YYYY-MM-DD` labels and cannot drift across a timezone or DST
 * boundary.
 */
export function DatePicker({
  id,
  label,
  value,
  onChange,
  description,
  descriptionClassName,
}: DatePickerProps) {
  const initial = parseIso(value ?? todayIso());
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(initial);
  const [visibleMonth, setVisibleMonth] = useState(monthStart(initial));
  const dayButtons = useRef(new Map<string, HTMLButtonElement>());
  const descriptionId = `${id}-description`;
  const monthHeadingId = `${id}-month`;
  const days = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);
  const currentIso = todayIso();

  function prepareOpen() {
    const next = parseIso(value ?? currentIso);
    setCursor(next);
    setVisibleMonth(monthStart(next));
  }

  function moveCursor(next: Date) {
    setCursor(next);
    setVisibleMonth(monthStart(next));
    requestAnimationFrame(() => {
      dayButtons.current.get(toIso(next))?.focus();
    });
  }

  function handleDayKey(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    let next: Date | null = null;
    switch (event.key) {
      case "ArrowLeft":
        next = addDays(date, -1);
        break;
      case "ArrowRight":
        next = addDays(date, 1);
        break;
      case "ArrowUp":
        next = addDays(date, -7);
        break;
      case "ArrowDown":
        next = addDays(date, 7);
        break;
      case "Home":
        next = addDays(date, -mondayIndex(date));
        break;
      case "End":
        next = addDays(date, 6 - mondayIndex(date));
        break;
      case "PageUp":
        next = addMonths(date, event.shiftKey ? -12 : -1);
        break;
      case "PageDown":
        next = addMonths(date, event.shiftKey ? 12 : 1);
        break;
      default:
        return;
    }

    event.preventDefault();
    moveCursor(next);
  }

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="text-fg-secondary block text-2xs font-semibold tracking-[0.08em] uppercase"
      >
        {label}
      </label>

      <Popover.Root
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) prepareOpen();
          setOpen(nextOpen);
        }}
      >
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            aria-label={label}
            aria-describedby={descriptionId}
            className={cn(
              "border-border-default bg-surface-card text-fg-primary grid h-10 w-full cursor-default",
              "grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2.5 text-left text-sm",
              "data-[state=open]:border-accent-border data-[state=open]:bg-surface-raised",
            )}
          >
            <CalendarDays size={14} strokeWidth={1.8} aria-hidden className="text-accent-fg" />
            <span className={cn("truncate font-medium", value === null && "text-fg-secondary")}>
              {value === null ? "Set a due date" : formatDate(parseIso(value))}
            </span>
            <span className="text-fg-secondary font-mono text-[9px] tracking-[0.08em] uppercase">
              {value === null ? "Open" : "Change"}
            </span>
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            collisionPadding={16}
            role="dialog"
            aria-label="Choose due date"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              requestAnimationFrame(() => {
                dayButtons.current.get(toIso(cursor))?.focus();
              });
            }}
            style={{ zIndex: "var(--z-toast)" }}
            className="border-border-default bg-surface-raised w-72 rounded-md border p-3 shadow-(--shadow-overlay)"
          >
            <div className="border-border-subtle mb-2 grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center border-b pb-2">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => {
                  moveCursor(addMonths(cursor, -1));
                }}
                className="text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary flex size-7 cursor-default items-center justify-center rounded-sm"
              >
                <ChevronLeft size={14} aria-hidden />
              </button>
              <h3
                id={monthHeadingId}
                aria-live="polite"
                className="text-fg-primary text-center text-sm font-semibold"
              >
                {new Intl.DateTimeFormat(undefined, {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(visibleMonth)}
              </h3>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => {
                  moveCursor(addMonths(cursor, 1));
                }}
                className="text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary flex size-7 cursor-default items-center justify-center rounded-sm"
              >
                <ChevronRight size={14} aria-hidden />
              </button>
            </div>

            <div role="grid" aria-labelledby={monthHeadingId}>
              <div role="row" className="grid grid-cols-7">
                {WEEKDAYS.map((weekday) => (
                  <div
                    key={weekday.long}
                    role="columnheader"
                    aria-label={weekday.long}
                    className="text-fg-secondary flex h-7 items-center justify-center font-mono text-[9px] font-medium uppercase"
                  >
                    {weekday.short}
                  </div>
                ))}
              </div>
              {Array.from({ length: 6 }, (_, row) => (
                <div key={row} role="row" className="grid grid-cols-7">
                  {days.slice(row * 7, row * 7 + 7).map((date) => {
                    const iso = toIso(date);
                    const selected = value === iso;
                    const focused = toIso(cursor) === iso;
                    const outside = date.getUTCMonth() !== visibleMonth.getUTCMonth();
                    return (
                      <div
                        key={iso}
                        role="gridcell"
                        aria-selected={selected}
                        className="p-0.5 text-center"
                      >
                        <button
                          ref={(element) => {
                            if (element === null) dayButtons.current.delete(iso);
                            else dayButtons.current.set(iso, element);
                          }}
                          type="button"
                          data-date={iso}
                          aria-label={formatDate(date, true)}
                          aria-current={iso === currentIso ? "date" : undefined}
                          tabIndex={focused ? 0 : -1}
                          onFocus={() => {
                            setCursor(date);
                          }}
                          onKeyDown={(event) => {
                            handleDayKey(event, date);
                          }}
                          onClick={() => {
                            onChange(iso);
                            setOpen(false);
                          }}
                          className={cn(
                            "relative mx-auto flex size-7 cursor-default items-center justify-center rounded-sm font-mono text-xs",
                            selected
                              ? "bg-accent-solid text-on-accent-solid font-semibold"
                              : outside
                                ? "text-fg-secondary opacity-55 hover:bg-surface-sunken hover:opacity-100"
                                : "text-fg-primary hover:bg-surface-sunken",
                            iso === currentIso && !selected
                              ? "after:bg-accent-solid after:absolute after:bottom-0.5 after:size-0.5 after:rounded-full"
                              : "",
                          )}
                        >
                          {date.getUTCDate()}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="border-border-subtle mt-2 flex items-center justify-between border-t pt-2">
              <button
                type="button"
                onClick={() => {
                  onChange(currentIso);
                  setOpen(false);
                }}
                className="text-accent-fg hover:bg-surface-sunken cursor-default rounded-sm px-2 py-1.5 text-xs font-medium"
              >
                Today
              </button>
              <button
                type="button"
                disabled={value === null}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary flex cursor-default items-center gap-1 rounded-sm px-2 py-1.5 text-xs disabled:pointer-events-none disabled:opacity-45"
              >
                <X size={12} aria-hidden />
                Clear due date
              </button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <p id={descriptionId} className={cn("text-2xs", descriptionClassName)}>
        {description}
      </p>
    </div>
  );
}
