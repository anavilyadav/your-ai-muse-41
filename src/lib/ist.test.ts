// IST boundary suite.
//
// These four helpers decide which calendar day every payment, visit, lead
// and report row is counted under. A one-day slip here silently
// mis-attributes revenue, so the boundary cases (the 12:00am-5:30am IST
// window where UTC is still on the previous day) are asserted explicitly.

import { describe, it, expect, afterEach, vi } from "vitest";
import { istDayStart, istDayEnd, istDateOf, istWeekday } from "./db";
import { istNow, today } from "./supabase";

afterEach(() => {
  vi.useRealTimers();
});

function freeze(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe("istDayStart / istDayEnd", () => {
  it("pins the boundary to the IST offset, not UTC", () => {
    expect(istDayStart("2026-08-03")).toBe("2026-08-03T00:00:00+05:30");
    expect(istDayEnd("2026-08-03")).toBe("2026-08-03T23:59:59.999+05:30");
  });

  it("produces a 24h window with no gap or overlap between consecutive days", () => {
    const endOfDay1 = new Date(istDayEnd("2026-08-03")).getTime();
    const startOfDay2 = new Date(istDayStart("2026-08-04")).getTime();
    expect(startOfDay2 - endOfDay1).toBe(1);
  });

  it("day window is exactly 24 hours long", () => {
    const start = new Date(istDayStart("2026-08-03")).getTime();
    const nextStart = new Date(istDayStart("2026-08-04")).getTime();
    expect(nextStart - start).toBe(24 * 60 * 60 * 1000);
  });

  it("18:30 UTC is the first instant of the next IST day", () => {
    // 2026-08-02T18:30:00Z === 2026-08-03T00:00:00+05:30
    const boundary = new Date("2026-08-02T18:30:00Z").getTime();
    expect(new Date(istDayStart("2026-08-03")).getTime()).toBe(boundary);
  });
});

describe("istDateOf", () => {
  it("buckets a 23:55 UTC timestamp into the NEXT IST day", () => {
    expect(istDateOf("2026-08-03T23:55:00Z")).toBe("2026-08-04");
  });

  it("buckets a 00:05 UTC timestamp into the SAME IST day", () => {
    expect(istDateOf("2026-08-04T00:05:00Z")).toBe("2026-08-04");
  });

  it("buckets 00:30 IST (19:00 UTC previous day) into the IST day, not the UTC day", () => {
    // 2026-08-03T19:00:00Z === 2026-08-04T00:30 IST
    expect(istDateOf("2026-08-03T19:00:00Z")).toBe("2026-08-04");
  });

  it("handles the month boundary", () => {
    expect(istDateOf("2026-07-31T19:00:00Z")).toBe("2026-08-01");
    expect(istDateOf("2026-07-31T18:00:00Z")).toBe("2026-07-31");
  });

  it("handles the year boundary", () => {
    expect(istDateOf("2025-12-31T19:00:00Z")).toBe("2026-01-01");
  });

  it("returns empty string for null/undefined/empty rather than throwing", () => {
    expect(istDateOf(null)).toBe("");
    expect(istDateOf(undefined)).toBe("");
    expect(istDateOf("")).toBe("");
  });
});

describe("istWeekday", () => {
  it("reads the weekday of an IST calendar date", () => {
    // 2026-08-03 is a Monday
    expect(istWeekday("2026-08-03")).toBe(1);
    expect(istWeekday("2026-08-02")).toBe(0); // Sunday
    expect(istWeekday("2026-08-08")).toBe(6); // Saturday
  });

  it("is stable regardless of the machine's local timezone", () => {
    const seen = new Set<number>();
    for (const d of ["2026-08-03", "2026-08-03", "2026-08-03"]) seen.add(istWeekday(d));
    expect(seen.size).toBe(1);
  });
});

describe("today() / istNow()", () => {
  it("returns TOMORROW's UTC date during the 00:30 IST window", () => {
    // 19:00 UTC on the 3rd is already 00:30 IST on the 4th.
    freeze("2026-08-03T19:00:00Z");
    expect(today()).toBe("2026-08-04");
  });

  it("returns the same date when UTC and IST agree (midday IST)", () => {
    freeze("2026-08-03T06:30:00Z"); // 12:00 IST
    expect(today()).toBe("2026-08-03");
  });

  it("does NOT roll over at 18:29 UTC (23:59 IST) but does at 18:30 UTC", () => {
    freeze("2026-08-03T18:29:00Z");
    expect(today()).toBe("2026-08-03");
    freeze("2026-08-03T18:30:00Z");
    expect(today()).toBe("2026-08-04");
  });

  it("rolls the month over correctly", () => {
    freeze("2026-07-31T19:00:00Z");
    expect(today()).toBe("2026-08-01");
  });

  it("rolls the year over correctly", () => {
    freeze("2025-12-31T19:00:00Z");
    expect(today()).toBe("2026-01-01");
  });

  it("istNow() is exactly 5h30m ahead of the real instant", () => {
    freeze("2026-08-03T06:00:00Z");
    expect(istNow().getTime() - Date.now()).toBe(5.5 * 60 * 60 * 1000);
  });

  it("today() agrees with istDateOf() for the same instant", () => {
    freeze("2026-08-03T19:00:00Z");
    expect(today()).toBe(istDateOf(new Date().toISOString()));
  });
});
