import { addDays, daysBetween, isDateKey, parseDateKey, startOfWeek, toDateKey } from "#system/homework-date";
import { describe, expect, it } from "vitest";

/**
 * Unit tests for the date helpers in `src/system/homework-date.ts`.
 * @module
 */

describe("Homework - dates", () => {
  it("formats and parses local date keys symmetrically", () => {
    expect(toDateKey(new Date(2026, 7, 3))).toBe("2026-08-03");
    expect(parseDateKey("2026-08-03").getMonth()).toBe(7);
    expect(parseDateKey("2026-08-03").getDate()).toBe(3);
  });

  it("recognizes only real calendar dates", () => {
    expect(isDateKey("2026-08-17")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("2026-8-17")).toBe(false);
    expect(isDateKey("")).toBe(false);
    expect(isDateKey(20260817)).toBe(false);
  });

  it("moves across month and year boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("counts whole days in both directions", () => {
    expect(daysBetween("2026-08-17", "2026-08-20")).toBe(3);
    expect(daysBetween("2026-08-20", "2026-08-17")).toBe(-3);
    expect(daysBetween("2026-08-17", "2026-08-17")).toBe(0);
  });

  it("counts whole days across a daylight-saving change", () => {
    // Spring forward and fall back in most northern-hemisphere zones.
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("starts weeks on Monday", () => {
    // 2026-08-17 is a Monday, 2026-08-23 the Sunday that ends the same week.
    expect(startOfWeek("2026-08-17")).toBe("2026-08-17");
    expect(startOfWeek("2026-08-23")).toBe("2026-08-17");
    expect(startOfWeek("2026-08-24")).toBe("2026-08-24");
  });
});
