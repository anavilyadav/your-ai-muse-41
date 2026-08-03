// Money math suite.
//
// Every number in here ends up on a receipt. Fee-kind resolution, the
// stacking of owner-managed extra rules (including negative/discount
// rules and the conditional re-case surcharge), and the re-case gap
// window are all asserted exactly — not approximately.

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  DEFAULT_FEE_MASTER,
  DEFAULT_FEE_RULES,
  feeKindForVisit,
  activeFeeRulesTotal,
  needsRecaseSurcharge,
  normalizePaymentMode,
  type FeeRule,
} from "./db";

afterEach(() => {
  vi.useRealTimers();
});

const rule = (over: Partial<FeeRule>): FeeRule => ({
  id: "r",
  key: "CUSTOM",
  label: "Rule",
  amount: 0,
  appliesTo: "ALL",
  ...over,
});

describe("feeKindForVisit", () => {
  it("ONLINE beats everything, even a first visit", () => {
    expect(feeKindForVisit({ visit_type: "ONLINE", patient: { lifetime_visits: 1 } })).toBe("ONLINE");
    expect(feeKindForVisit({ visit_type: "online", patient: { lifetime_visits: 12 } })).toBe("ONLINE");
  });

  it("first visit (lifetime_visits <= 1) is a NEW case", () => {
    expect(feeKindForVisit({ visit_type: "WALKIN", patient: { lifetime_visits: 1 } })).toBe("NEW");
    expect(feeKindForVisit({ visit_type: "WALKIN", patient: { lifetime_visits: 0 } })).toBe("NEW");
  });

  it("second visit onwards is a FOLLOWUP", () => {
    expect(feeKindForVisit({ visit_type: "WALKIN", patient: { lifetime_visits: 2 } })).toBe("FOLLOWUP");
    expect(feeKindForVisit({ visit_type: null, patient: { lifetime_visits: 99 } })).toBe("FOLLOWUP");
  });

  it("missing patient / missing lifetime_visits defaults to NEW, never crashes", () => {
    expect(feeKindForVisit({})).toBe("NEW");
    expect(feeKindForVisit({ visit_type: null, patient: null })).toBe("NEW");
    expect(feeKindForVisit({ patient: { lifetime_visits: null } })).toBe("NEW");
  });

  it("maps each kind onto a non-zero default fee", () => {
    for (const kind of ["NEW", "FOLLOWUP", "ONLINE"] as const) {
      expect(DEFAULT_FEE_MASTER[kind]).toBeGreaterThan(0);
    }
  });
});

describe("activeFeeRulesTotal", () => {
  it("returns zero for an empty rule list", () => {
    expect(activeFeeRulesTotal([], "NEW", false)).toEqual({ total: 0, applied: [] });
  });

  it("applies ALL rules to every fee kind", () => {
    const r = rule({ amount: 250, appliesTo: "ALL" });
    for (const kind of ["NEW", "FOLLOWUP", "ONLINE"] as const) {
      expect(activeFeeRulesTotal([r], kind, false).total).toBe(250);
    }
  });

  it("skips a rule scoped to a different fee kind", () => {
    const r = rule({ amount: 500, appliesTo: "ONLINE" });
    expect(activeFeeRulesTotal([r], "NEW", false).total).toBe(0);
    expect(activeFeeRulesTotal([r], "ONLINE", false).total).toBe(500);
  });

  it("only applies a RECASE rule when the gap condition is also met", () => {
    const r = rule({ key: "RECASE", amount: 1000, appliesTo: "FOLLOWUP" });
    expect(activeFeeRulesTotal([r], "FOLLOWUP", false).total).toBe(0);
    expect(activeFeeRulesTotal([r], "FOLLOWUP", true).total).toBe(1000);
  });

  it("a RECASE rule still respects appliesTo even when the gap condition is met", () => {
    const r = rule({ key: "RECASE", amount: 1000, appliesTo: "FOLLOWUP" });
    expect(activeFeeRulesTotal([r], "NEW", true).total).toBe(0);
  });

  it("supports negative (discount) amounts", () => {
    const rules = [rule({ id: "a", amount: 1000 }), rule({ id: "b", amount: -300 })];
    expect(activeFeeRulesTotal(rules, "NEW", false).total).toBe(700);
  });

  it("a discount can take the extras total below zero (owner's call, not clamped here)", () => {
    expect(activeFeeRulesTotal([rule({ amount: -500 })], "NEW", false).total).toBe(-500);
  });

  it("treats a non-numeric amount as zero rather than producing NaN", () => {
    const bad = rule({ amount: "oops" as unknown as number });
    const res = activeFeeRulesTotal([bad, rule({ id: "ok", amount: 100 })], "NEW", false);
    expect(res.total).toBe(100);
    expect(Number.isNaN(res.total)).toBe(false);
  });

  it("stacks several matching rules and reports exactly which applied", () => {
    const rules = [
      rule({ id: "a", amount: 100, appliesTo: "ALL" }),
      rule({ id: "b", amount: 200, appliesTo: "FOLLOWUP" }),
      rule({ id: "c", amount: 400, appliesTo: "ONLINE" }),
    ];
    const res = activeFeeRulesTotal(rules, "FOLLOWUP", false);
    expect(res.total).toBe(300);
    expect(res.applied.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("the shipped default rule set is the re-case surcharge on follow-ups only", () => {
    expect(activeFeeRulesTotal(DEFAULT_FEE_RULES, "FOLLOWUP", true).total).toBe(1000);
    expect(activeFeeRulesTotal(DEFAULT_FEE_RULES, "FOLLOWUP", false).total).toBe(0);
    expect(activeFeeRulesTotal(DEFAULT_FEE_RULES, "NEW", true).total).toBe(0);
  });
});

describe("needsRecaseSurcharge", () => {
  it("never applies to a first-ever visit", () => {
    expect(needsRecaseSurcharge(1, "2020-01-01")).toBe(false);
    expect(needsRecaseSurcharge(0, "2020-01-01")).toBe(false);
    expect(needsRecaseSurcharge(null, "2020-01-01")).toBe(false);
  });

  it("does not guess when the previous visit date is missing", () => {
    expect(needsRecaseSurcharge(5, null)).toBe(false);
  });

  it("applies when the gap is over a year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T06:00:00Z"));
    expect(needsRecaseSurcharge(5, "2025-01-01")).toBe(true);
  });

  it("does not apply at exactly 365 days, only strictly beyond", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T00:00:00Z"));
    expect(needsRecaseSurcharge(5, "2025-08-03")).toBe(false); // exactly 365
    expect(needsRecaseSurcharge(5, "2025-08-02")).toBe(true); // 366
  });

  it("does not apply for a recent follow-up", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T06:00:00Z"));
    expect(needsRecaseSurcharge(5, "2026-07-01")).toBe(false);
  });
});

describe("normalizePaymentMode (revenue-split bucketing)", () => {
  it("never returns an unbucketed value, so mode totals always add up", () => {
    const inputs = ["CASH", "upi", "Card", "NEFT", "", null, undefined, "  ", "cheque"];
    for (const i of inputs) {
      expect(["CASH", "UPI", "CARD", "OTHER"]).toContain(normalizePaymentMode(i));
    }
  });
});
