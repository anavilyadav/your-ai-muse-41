// Stock movement suite (26 Aug 2026).
//
// Two money-adjacent invariants live here:
//   1. Stock top-ups must go through increment_stock (read-modify-write in
//      JS loses one of two concurrent entries).
//   2. Dispensing must never "succeed" while stock is left untouched —
//      that produces phantom shelf quantities that only surface weeks
//      later as an unexplained shortage.

import { describe, it, expect, vi } from "vitest";
import { createSupabaseMock, degradedAlerts, type MockResult } from "../test/supabase-mock";

const state: { mock: ReturnType<typeof createSupabaseMock> } = {
  mock: createSupabaseMock(),
};

vi.mock("./supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./supabase")>();
  return {
    ...actual,
    supabase: new Proxy({} as any, {
      get: (_t, prop) => (state.mock.client as any)[prop],
    }),
  };
});

function setup(
  opts: { rpc?: Record<string, MockResult | ((args: any) => MockResult)>; table?: Record<string, MockResult> } = {},
) {
  state.mock = createSupabaseMock(opts);
  return state.mock;
}

describe("addStockEntry", () => {
  it("increments through the RPC rather than reading and writing stock in JS", async () => {
    const m = setup({
      rpc: { increment_stock: { data: null, error: null } },
      table: { stock_entries: { error: null } },
    });
    const { addStockEntry } = await import("./db");
    const res = await addStockEntry({
      medicine_name: "Arnica",
      potency: "30C",
      branch: "BAJAJ_NAGAR",
      drams: 10,
      entered_by: "u-1",
    });

    expect(res.success).toBe(true);
    expect(m.rpcCalls.find((c) => c.name === "increment_stock")).toBeTruthy();
    expect(degradedAlerts(m.tableCalls)).toHaveLength(0);
  });

  it("records the paper trail entry alongside the increment", async () => {
    const m = setup({
      rpc: { increment_stock: { data: null, error: null } },
      table: { stock_entries: { error: null } },
    });
    const { addStockEntry } = await import("./db");
    await addStockEntry({
      medicine_name: "Arnica",
      potency: "30C",
      branch: "BAJAJ_NAGAR",
      drams: 10,
      entered_by: "u-1",
    });
    expect(m.tableCalls.some((c) => c.table === "stock_entries" && c.op === "insert")).toBe(true);
  });

  it("raises a degraded alert when it has to fall back to read-modify-write", async () => {
    const m = setup({
      table: { inventory: { data: { id: "i-1", stock_drams: 5 }, error: null }, stock_entries: { error: null }, system_alerts: { error: null } },
    });
    const { addStockEntry } = await import("./db");
    const res = await addStockEntry({
      medicine_name: "Arnica",
      potency: "30C",
      branch: "BAJAJ_NAGAR",
      drams: 10,
      entered_by: "u-1",
    });
    // It still works (staff can keep adding stock), but loudly.
    expect(res.success).toBe(true);
    expect(degradedAlerts(m.tableCalls).length).toBeGreaterThan(0);
  });

  it("rejects a non-positive quantity before any write happens", async () => {
    const m = setup({ rpc: { increment_stock: { data: null, error: null } } });
    const { addStockEntry } = await import("./db");
    const res = await addStockEntry({
      medicine_name: "Arnica",
      potency: "30C",
      branch: "BAJAJ_NAGAR",
      drams: 0,
      entered_by: "u-1",
    });
    expect(res.success).toBe(false);
    expect(m.rpcCalls).toHaveLength(0);
  });
});

describe("markDispensed", () => {
  it("goes through the atomic dispense RPC", async () => {
    const m = setup({ rpc: { dispense_visit_atomic: { data: null, error: null } } });
    const { markDispensed } = await import("./db");
    const res = await markDispensed("v-1");
    expect(res.success).toBe(true);
    expect(m.rpcCalls.map((c) => c.name)).toContain("dispense_visit_atomic");
  });

  it("fails loudly instead of marking the visit dispensed without decrementing stock", async () => {
    // The old fallback flipped visit_status to DISPENSED even when the
    // stock decrement never ran — the exact source of phantom stock.
    const m = setup({ table: { visits: { error: null } } });
    const { markDispensed } = await import("./db");
    const res = await markDispensed("v-1");
    expect(res.success).toBe(false);
    expect(m.tableCalls.filter((c) => c.table === "visits" && c.op === "update")).toHaveLength(0);
  });

  it("surfaces an out-of-stock rejection from the RPC to the caller", async () => {
    setup({ rpc: { dispense_visit_atomic: { error: { message: "insufficient stock for Arnica 30C" } } } });
    const { markDispensed } = await import("./db");
    const res = await markDispensed("v-1");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/insufficient stock/);
  });
});

describe("summarizeStockByMedicine", () => {
  it("totals a medicine across branches and collects its potencies", async () => {
    const { summarizeStockByMedicine } = await import("./db");
    const map = summarizeStockByMedicine([
      { medicine_name: "Arnica", potency: "30C", branch: "BAJAJ_NAGAR", stock_drams: 4 },
      { medicine_name: "Arnica", potency: "200C", branch: "VAISHALI", stock_drams: 6 },
      { medicine_name: "Arnica", potency: "30C", branch: "VAISHALI", stock_drams: 1 },
    ]);
    const arnica = map.get("Arnica")!;
    expect(arnica.total).toBe(11);
    expect(arnica.byBranch).toEqual({ BAJAJ_NAGAR: 4, VAISHALI: 7 });
    expect([...arnica.potencies].sort()).toEqual(["200C", "30C"]);
  });

  it("excludes soft-deleted rows from the totals", async () => {
    const { summarizeStockByMedicine } = await import("./db");
    const map = summarizeStockByMedicine([
      { medicine_name: "Nux", potency: "30C", branch: "BAJAJ_NAGAR", stock_drams: 5 },
      { medicine_name: "Nux", potency: "30C", branch: "BAJAJ_NAGAR", stock_drams: 99, is_deleted: true },
    ]);
    expect(map.get("Nux")!.total).toBe(5);
  });

  it("treats missing or non-numeric stock as zero rather than NaN", async () => {
    // One bad row must not turn a whole branch total into NaN on screen.
    const { summarizeStockByMedicine } = await import("./db");
    const map = summarizeStockByMedicine([
      { medicine_name: "Sulphur", potency: "200C", branch: "BAJAJ_NAGAR", stock_drams: null },
      { medicine_name: "Sulphur", potency: "200C", branch: "BAJAJ_NAGAR", stock_drams: 3 },
    ]);
    expect(map.get("Sulphur")!.total).toBe(3);
  });
});
