import { describe, expect, it } from "vitest";
import { advanceExcess, remainingAfterAdvance } from "./advance";

describe("advance on the final bill", () => {
  it("deducts the advance from the fee", () => {
    expect(remainingAfterAdvance(2500, 1000)).toBe(1500);
    expect(remainingAfterAdvance(3500, 3500)).toBe(0);
  });
  it("never goes below zero and reports the excess", () => {
    expect(remainingAfterAdvance(2500, 3500)).toBe(0);
    expect(advanceExcess(2500, 3500)).toBe(1000);
    expect(advanceExcess(2500, 1000)).toBe(0);
  });
  it("treats missing numbers as zero", () => {
    expect(remainingAfterAdvance(2500, NaN)).toBe(2500);
  });
});
