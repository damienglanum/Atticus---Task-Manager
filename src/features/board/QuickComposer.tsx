import { useEffect, useRef, useState } from "react";

interface QuickComposerProps {
  columnName: string;
  onCreate: (title: string) => void;
  onClose: () => void;
}

/**
 * Capture a task in one field.
 *
 * `Enter` creates and stays open for the next one; `Escape` closes and returns
 * focus where it came from. An empty title is a no-op rather than an error —
 * pressing Enter on an empty box means "I have nothing more", not "I made a
 * mistake", and answering it with a red message would be rude (US-9 AC3).
 */
export function QuickComposer({ columnName, onCreate, onClose }: QuickComposerProps) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit() {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      onClose();
      return;
    }

    onCreate(trimmed);
    setTitle("");
  }

  return (
    <form
      className="px-1 pb-1"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="sr-only" htmlFor={`composer-${columnName}`}>
        {`New task in ${columnName}`}
      </label>
      <textarea
        id={`composer-${columnName}`}
        ref={inputRef}
        value={title}
        rows={2}
        // Deliberately **not** disabled while the create is in flight. Disabling
        // a focused element blurs it, `onBlur` then sees an empty box and closes
        // the composer — so the "Enter keeps it open for the next one" promise
        // silently broke on every task. Creation is a local SQLite insert; there
        // is nothing worth blocking typing for.
        placeholder="What needs doing?"
        onChange={(event) => {
          setTitle(event.target.value);
        }}
        onKeyDown={(event) => {
          // Enter submits; Shift+Enter is a newline, because a task title long
          // enough to want a line break is a real thing to type.
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        onBlur={() => {
          // Clicking away with text still in the box would otherwise discard it
          // silently. Committing is the kinder default; the text was typed on
          // purpose.
          if (title.trim().length > 0) submit();
          else onClose();
        }}
        className="border-border-strong bg-surface-raised text-fg-primary placeholder:text-fg-secondary w-full resize-none rounded-md border px-2.5 py-2 text-xs leading-snug"
      />
      <p className="text-fg-secondary mt-1 text-2xs">Enter to add · Escape to close</p>
    </form>
  );
}
