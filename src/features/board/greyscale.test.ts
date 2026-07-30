// @vitest-environment node
//
// The greyscale pass.
//
// `design-decisions.md` §3 commits to non-colour encoding everywhere — priority,
// due-date state and a work-in-progress breach each carry a glyph or words as
// well as a colour — and says this is "the test we actually run in milestone 8".
// This is that test, stated as the property it is protecting: **remove the
// colour and the signal must still be readable.**
//
// The screenshot half lives in `e2e/specs/visual.e2e.ts`, which photographs a
// real board under `filter: grayscale(1)`. A picture shows the encodings
// surviving; only this file can fail when someone removes one.
import { describe, expect, it } from "vitest";

import { DUE_STATES, describeDue, todayIso } from "./dates";
import { PRIORITIES, priorityLevel } from "./priority";

/** A date that lands in the given state relative to today, for describing. */
function dateInState(state: (typeof DUE_STATES)[number]): string | null {
  const today = new Date();
  const shift = { overdue: -2, today: 0, soon: 2, future: 30, none: 0 }[state];
  if (state === "none") return null;

  const target = new Date(today.getFullYear(), today.getMonth(), today.getDate() + shift);
  return todayIso(target);
}

describe("greyscale", () => {
  describe("priority", () => {
    it("gives every level its own glyph, so the scale survives without colour", () => {
      const icons = PRIORITIES.map((level) => level.icon);

      expect(new Set(icons).size).toBe(PRIORITIES.length);
    });

    it("gives every level its own words as well", () => {
      const labels = PRIORITIES.map((level) => level.label);

      expect(new Set(labels).size).toBe(PRIORITIES.length);
    });

    // The one that gives the two above their teeth. If every level had its own
    // tone, a reader could tell them apart by colour and the glyphs would be
    // decoration — passing tests that prove nothing. Two levels share a tone, so
    // colour genuinely cannot separate the scale and the glyph is load-bearing.
    it("cannot be read by colour alone, because two levels share a tone", () => {
      const tones = PRIORITIES.map((level) => level.tone);

      expect(new Set(tones).size).toBeLessThan(PRIORITIES.length);
    });

    it("falls back to None rather than rendering an unencoded value", () => {
      // A priority outside the scale can only come from a hand-edited database.
      // Rendering nothing would leave a card with a colour and no glyph.
      expect(priorityLevel(99)).toBe(PRIORITIES[0]);
      expect(priorityLevel(-1)).toBe(PRIORITIES[0]);
    });
  });

  describe("due date", () => {
    it("says in words which state it is in, for every state that renders one", () => {
      const described = DUE_STATES.filter((state) => state !== "none").map((state) =>
        describeDue(dateInState(state)),
      );

      for (const words of described) {
        expect(words).not.toBe("");
      }
      // Distinct as well as non-empty: "Overdue by 2 days", "Due today" and
      // "Due in 2 days" have to be four different sentences, or the words are
      // no better than the colour they are backing up.
      expect(new Set(described).size).toBe(described.length);
    });

    it("distinguishes no-due-date from due-today, which is the pair that matters", () => {
      // WebKit renders today's date greyed inside an empty date input, so these
      // two states look alike in the editor unless something says otherwise.
      // The editor prints "No due date"; `describeDue` returns nothing for it,
      // and that difference is what the editor keys off.
      expect(describeDue(null)).toBe("");
      expect(describeDue(todayIso())).toBe("Due today");
    });
  });
});
