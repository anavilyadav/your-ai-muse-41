import { describe, expect, it } from "vitest";
import { baseNumber, EXPECTED_REGISTER_SIZE, formatNumberRanges, registerGaps } from "./cardGaps";

describe("registerGaps", () => {
  it("checks every number up to 100 even when the highest entry is lower", () => {
    const g = registerGaps(["01", "02", "04", "07"]);
    expect(g.highest).toBe(7);
    expect(g.checkedUpTo).toBe(EXPECTED_REGISTER_SIZE);
    expect(g.missing).toContain(3);
    expect(g.missing).toContain(100);
    expect(g.missing.length).toBe(100 - 4);
  });

  it("goes past 100 when the register already does", () => {
    const g = registerGaps(["99", "100", "104"]);
    expect(g.checkedUpTo).toBe(104);
    expect(g.missing).toContain(101);
    expect(g.missing).toContain(103);
  });

  it("counts 26A and 26B as number 26 being present", () => {
    const g = registerGaps(["25", "26A", "26B", "27"]);
    expect(g.missing).not.toContain(26);
    expect(g.present).toBe(3);
    expect(g.doubles).toBe(1);
  });

  it("reports numbers held by a deleted patient as hidden, not missing", () => {
    const g = registerGaps(["01", "03"], ["02"]);
    expect(g.hidden).toEqual([2]);
    expect(g.missing).not.toContain(2);
  });

  it("does not call a number hidden when a live patient has it too", () => {
    expect(registerGaps(["02"], ["02"]).hidden).toEqual([]);
  });

  it("copes with empty and unparsable numbers", () => {
    const g = registerGaps(["", null, "x"]);
    expect(g.present).toBe(0);
    expect(g.missing.length).toBe(100);
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
