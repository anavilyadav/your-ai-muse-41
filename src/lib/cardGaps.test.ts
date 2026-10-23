import { describe, expect, it } from "vitest";
import { baseNumber, formatNumberRanges, registerGaps } from "./cardGaps";

describe("registerGaps", () => {
  it("lists numbers missing below the highest one", () => {
    const g = registerGaps(["01", "02", "04", "07"]);
    expect(g.missing).toEqual([3, 5, 6]);
    expect(g.highest).toBe(7);
    expect(g.present).toBe(4);
  });

  it("counts 26A and 26B as number 26 being present", () => {
    const g = registerGaps(["25", "26A", "26B", "27"]);
    expect(g.missing.filter((n) => n >= 25)).toEqual([]);
    expect(g.present).toBe(3);
    expect(g.doubles).toBe(1);
  });

  it("treats a register that does not start at 1 as missing the start", () => {
    expect(registerGaps(["04", "05"]).missing).toEqual([1, 2, 3]);
  });

  it("copes with empty and unparsable numbers", () => {
    expect(registerGaps([])).toEqual({ present: 0, highest: 0, missing: [], doubles: 0 });
    expect(registerGaps(["", null, "x"]).present).toBe(0);
  });

  it("reads numbers past 99", () => {
    expect(registerGaps(["99", "100", "102"]).missing.slice(-1)).toEqual([101]);
  });
});

describe("baseNumber / formatNumberRanges", () => {
  it("takes the leading digits", () => {
    expect(baseNumber("07")).toBe(7);
    expect(baseNumber("26B")).toBe(26);
    expect(baseNumber("B")).toBeNull();
  });

  it("collapses runs", () => {
    expect(formatNumberRanges([1, 2, 3, 5, 9, 10, 12])).toBe("1-3, 5, 9, 10, 12");
    expect(formatNumberRanges([16, 17, 18])).toBe("16-18");
    expect(formatNumberRanges([])).toBe("");
  });
});
