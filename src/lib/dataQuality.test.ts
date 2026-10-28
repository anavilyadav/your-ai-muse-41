import { describe, expect, it } from "vitest";
import { computeLocalDataQualityFlags } from "./db";

const base = { name: "Sunita", mobile: "9876543210", card_series: "B", card_register: "78", card_number: "50" };

describe("computeLocalDataQualityFlags", () => {
  it("does not flag a name without a surname", () => {
    const f = computeLocalDataQualityFlags({ ...base, name: "Sunita" });
    expect(f.incompleteName).toBe(false);
    expect(f.hasAny).toBe(false);
  });

  it("flags a missing mobile", () => {
    expect(computeLocalDataQualityFlags({ ...base, mobile: "" }).missingMobile).toBe(true);
  });

  it("flags a missing or half-filled card", () => {
    expect(computeLocalDataQualityFlags({ ...base, card_series: "", card_register: "", card_number: "" }).missingCard).toBe(true);
    expect(computeLocalDataQualityFlags({ ...base, card_number: "" }).partialCard).toBe(true);
  });

  it("treats a 1T-5T card without a register as complete", () => {
    const f = computeLocalDataQualityFlags({ ...base, card_series: "3T", card_register: "", card_number: "37" });
    expect(f.partialCard).toBe(false);
    expect(f.missingCard).toBe(false);
  });
});
