// Stock movement suite (26 Aug 2026).
//
// Two invariants live here:
//   1. Stock top-ups must go through increment_stock — a read-modify-write
//      in JS loses one of two concurrent entries ("lost update").
//   2. Dispensing must never "succeed" while stock is left untouched, which
//      produces phantom shelf quantities that only surface weeks later as
//      an unexplained shortage.

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

const entry = { medicine_name: "Arnica", potency: "30C", branch: "BAJAJ_NAGAR", quantity: 10 };

describe("addStockEntry", () => {
  it("increments through the row-locked RPC rather than reading and writing stock in JS", async () => {
    const m = setup({ rpc: { increment_stock: { data: { id: "i-1" }, error: null } } });
    const { addStockEntry } = await import("./db");
    const res = await addStockEntry(entry);

    expect(res.success).toBe(true);
    expect(m.rpcCalls.find((c) => c.name === "increment_stock")?.args).toMatchObject({
      p_medicine_name: "Arnica",
      p_potency: "30C",
      p_branch: "BAJAJ_NAGAR",
      p_quantity: 10,
    });
    // No client-side read-modify-write on the happy path.
    expect(m.tableCalls.filter((c) => c.table === "inventory")).toHaveLength(0);
    expect(degradedAlerts(m.tableCalls)).toHaveLength(0);
  });

  it("passes an explicit null type when none was chosen, instead of dropping the argument", async () => {
    const m = setup({ rpc: { increment_stock: { data: null, error: null } } });
    const { addStockEntry } = await import("./db");
    await addStockEntry(entry);
    expect(m.rpcCalls[0].args).toHaveProperty("p_type", null);
  });

  it("raises a degraded alert when it has to fall back to read-modify-write", async () => {
    const m = setup({
      table: {
        inventory: { data: { id: "i-1", stock_drams: 5 }, error: null },
        system_alerts: { error: null },
      },
    });
    const { addStockEntry } = await import("./db");
    const res = await addStockEntry(entry);

    // Staff can keep adding stock, but the degradation is announced.
    expect(res.success).toBe(true);
    expect(degradedAlerts(m.tableCalls).length).toBeGreaterThan(0);
    expect(m.tableCalls.some((c) => c.table === "inventory" && c.op === "update")).toBe(true);
  });

  it("adds to the existing quantity on the fallback path — never overwrites it", async () => {
    const m = setup({
      table: {
        inventory: { data: { id: "i-1", stock_drams: 5 }, error: null },
        system_alerts: { error: null },
      },
    });
    const { addStockEntry } = await import("./db");
    await addStockEntry(entry);
    const update = m.tableCalls.find((c) => c.table === "inventory" && c.op === "update")!;
    expect(update.payload).toEqual({ stock_drams: 15 });
  });

  it("creates a fresh inventory row when the medicine+potency+branch combo is new", async () => {
    const m = setup({
      table: { inventory: { data: null, error: null }, system_alerts: { error: null } },
    });
    const { addStockEntry } = await import("./db");
    await addStockEntry(entry);
    const insert = m.tableCalls.find((c) => c.table === "inventory" && c.op === "insert")!;
    expect(insert.payload).toMatchObject({ medicine_name: "Arnica", potency: "30C", stock_drams: 10 });
  });

  it("reports the failure instead of claiming success when even the fallback write fails", async () => {
    setup({
      table: { inventory: { data: null, error: { message: "insert denied" } }, system_alerts: { error: null } },
    });
    const { addStockEntry } = await import("./db");
    const res = await addStockEntry(entry);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/insert denied/);
  });
});

describe("addBulkStockEntries", () => {
  it("runs one increment per potency and counts them all as succeeded", async () => {
    const m = setup({ rpc: { increment_stock: { data: null, error: null } } });
    const { addBulkStockEntries } = await import("./db");
    const res = await addBulkStockEntries("Arnica", "BAJAJ_NAGAR", [
      { potency: "30C", quantity: 4 },
      { potency: "200C", quantity: 6 },
    ]);
    expect(res.succeeded).toBe(2);
    expect(res.failed).toEqual([]);
    expect(m.rpcCalls.filter((c) => c.name === "increment_stock")).toHaveLength(2);
  });

  it("keeps the good rows and reports only the bad potency, rather than losing the batch", async () => {
    setup({
      rpc: {
        increment_stock: (args: any) =>
          args.p_potency === "200C"
            ? { error: { message: "bad potency" } }
            : { data: null, error: null },
      },
      table: { inventory: { data: null, error: { message: "bad potency" } }, system_alerts: { error: null } },
    });
    const { addBulkStockEntries } = await import("./db");
    const res = await addBulkStockEntries("Arnica", "BAJAJ_NAGAR", [
      { potency: "30C", quantity: 4 },
      { potency: "200C", quantity: 6 },
    ]);
    expect(res.succeeded).toBe(1);
    expect(res.failed.map((f) => f.potency)).toEqual(["200C"]);
  });
});

describe("markDispensed", () => {
  it("goes through the atomic dispense RPC", async () => {
    const m = setup({ rpc: { dispense_visit_atomic: { data: { ok: true }, error: null } } });
    const { markDispensed } = await import("./db");
    await markDispensed("v-1");
    expect(m.rpcCalls.map((c) => c.name)).toContain("dispense_visit_atomic");
  });

  it("blocks the dispense entirely when the RPC is missing — no status flip without a stock decrement", async () => {
    // The removed fallback marked the visit DISPENSED while skipping the
    // inventory decrement: the exact source of phantom stock.
    const m = setup({ table: { visits: { error: null }, system_alerts: { error: null } } });
    const { markDispensed } = await import("./db");
    await expect(markDispensed("v-1")).rejects.toThrow(/dispense_visit_atomic/);
    expect(m.tableCalls.filter((c) => c.table === "visits" && c.op === "update")).toHaveLength(0);
    expect(degradedAlerts(m.tableCalls).length).toBeGreaterThan(0);
  });

  it("surfaces an out-of-stock rejection from the RPC to the caller", async () => {
    setup({ rpc: { dispense_visit_atomic: { error: { message: "insufficient stock for Arnica 30C" } } } });
    const { markDispensed } = await import("./db");
    await expect(markDispensed("v-1")).rejects.toThrow(/insufficient stock/);
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

  it("treats missing stock as zero rather than NaN", async () => {
    // One bad row must not turn a whole branch total into NaN on screen.
    const { summarizeStockByMedicine } = await import("./db");
    const map = summarizeStockByMedicine([
      { medicine_name: "Sulphur", potency: "200C", branch: "BAJAJ_NAGAR", stock_drams: null },
      { medicine_name: "Sulphur", potency: "200C", branch: "BAJAJ_NAGAR", stock_drams: 3 },
    ]);
    expect(map.get("Sulphur")!.total).toBe(3);
  });
});
