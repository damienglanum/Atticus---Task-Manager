import { describe, expect, it } from "vitest";

import {
  daysBetween,
  describeDue,
  dueState,
  formatEstimate,
  parseEstimate,
  todayIso,
} from "./dates";

const TODAY = "2026-07-30";

describe("dueState", () => {
  it("has no state without a date", () => {
    expect(dueState(null, TODAY)).toBe("none");
    expect(dueState("", TODAY)).toBe("none");
  });

  it("recognises today, soon, future and overdue", () => {
    expect(dueState("2026-07-30", TODAY)).toBe("today");
    expect(dueState("2026-07-31", TODAY)).toBe("soon");
    expect(dueState("2026-08-02", TODAY)).toBe("soon");
    expect(dueState("2026-08-03", TODAY)).toBe("future");
    expect(dueState("2026-07-29", TODAY)).toBe("overdue");
  });

  it("treats a malformed date as no date rather than throwing", () => {
    expect(dueState("not-a-date", TODAY)).toBe("none");
  });
});

describe("daysBetween", () => {
  it("counts whole days across a month boundary", () => {
    expect(daysBetween("2026-07-30", "2026-08-02")).toBe(3);
  });

  it("counts whole days across a year boundary", () => {
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("counts a leap day", () => {
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("is unaffected by a daylight-saving transition", () => {
    // Clocks in most of Europe go forward on 29 March 2026. A subtraction done
    // on local timestamps would give 0.958 days here and round to the wrong
    // answer; doing it on calendar labels cannot.
    expect(daysBetween("2026-03-28", "2026-03-29")).toBe(1);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    // And in autumn, when the day is 25 hours long.
    expect(daysBetween("2026-10-24", "2026-10-25")).toBe(1);
  });
});

describe("describeDue", () => {
  it("says how late, in words", () => {
    expect(describeDue("2026-07-29", TODAY)).toBe("Overdue by 1 day");
    expect(describeDue("2026-07-27", TODAY)).toBe("Overdue by 3 days");
  });

  it("says today and tomorrow rather than a count", () => {
    expect(describeDue("2026-07-30", TODAY)).toBe("Due today");
    expect(describeDue("2026-07-31", TODAY)).toBe("Due tomorrow");
  });

  it("counts the days when it is soon", () => {
    expect(describeDue("2026-08-01", TODAY)).toBe("Due in 2 days");
  });

  it("gives the date itself when it is far off", () => {
    expect(describeDue("2026-12-25", TODAY)).toMatch(/^Due /);
  });

  it("says nothing at all without a date", () => {
    expect(describeDue(null, TODAY)).toBe("");
  });
});

describe("todayIso", () => {
  it("uses local calendar fields, not a UTC conversion", () => {
    // 23:30 local on 30 July is still 30 July, even where that is already the
    // 31st in UTC. Taking the date from `toISOString()` would be wrong for
    // everyone east of Greenwich for part of every day.
    const lateEvening = new Date(2026, 6, 30, 23, 30, 0);
    expect(todayIso(lateEvening)).toBe("2026-07-30");
  });

  it("pads single-digit months and days", () => {
    expect(todayIso(new Date(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
  });
});

describe("formatEstimate", () => {
  it("formats hours and minutes", () => {
    expect(formatEstimate(90)).toBe("1h 30m");
    expect(formatEstimate(120)).toBe("2h");
    expect(formatEstimate(45)).toBe("45m");
  });

  it("shows nothing for no estimate", () => {
    expect(formatEstimate(null)).toBe("");
    expect(formatEstimate(0)).toBe("");
  });
});

describe("parseEstimate", () => {
  it("accepts a bare number as minutes", () => {
    expect(parseEstimate("90")).toBe(90);
  });

  it("accepts hours and minutes in either combination", () => {
    expect(parseEstimate("1h 30m")).toBe(90);
    expect(parseEstimate("2h")).toBe(120);
    expect(parseEstimate("45m")).toBe(45);
    expect(parseEstimate("1H30M")).toBe(90);
  });

  it("treats an empty field as no estimate", () => {
    expect(parseEstimate("")).toBeNull();
    expect(parseEstimate("   ")).toBeNull();
  });

  it("reports anything else as invalid rather than guessing", () => {
    for (const input of ["soon", "1.5h", "-30", "h", "1h 30"]) {
      expect(parseEstimate(input), input).toBe("invalid");
    }
  });
});
