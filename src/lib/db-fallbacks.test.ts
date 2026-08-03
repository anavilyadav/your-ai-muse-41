// Fallback / degraded-mode suite.
//
// Every "atomic" fix in db.ts has a fallback for when its RPC hasn't been
// applied to the database yet. The point of these tests is that the
// fallback is only ever reached when the RPC is genuinely missing, that it
// always raises a degraded-mode alert when it is reached, and that the
// money path (collectPayment) refuses to fall back at all.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

function setup(opts: { rpc?: Record<string, MockResult>; table?: Record<string, MockResult> } = {}) {
  state.mock = createSupabaseMock(opts);
  return state.mock;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-03T06:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("nextPatientCode", () => {
  it("uses the atomic sequence RPC when it exists and never touches the count fallback", async () => {
    const m = setup({ rpc: { next_patient_codes: { data: ["YHC-1042"], error: null } } });
    const { nextPatientCode } = await import("./db");
    expect(await nextPatientCode()).toBe("YHC-1042");
    expect(m.rpcCalls.map((c) => c.name)).toContain("next_patient_codes");
    expect(degradedAlerts(m.tableCalls)).toHaveLength(0);
  });

  it("falls back to count()+1 when the RPC is missing AND raises a degraded-mode alert", async () => {
    const m = setup({ table: { patients: { count: 41, error: null }, system_alerts: { error: null } } });
    const { nextPatientCode } = await import("./db");
    expect(await nextPatientCode()).toBe("YHC-1042");
    // The alert is the only thing that makes this silent degradation visible.
    expect(degradedAlerts(m.tableCalls).length).toBeGreaterThan(0);
  });

  it("reserves exactly one code per call", async () => {
    const m = setup({ rpc: { next_patient_codes: { data: ["YHC-1001"], error: null } } });
    const { nextPatientCode } = await import("./db");
    await nextPatientCode();
    expect(m.rpcCalls[0].args).toMatchObject({ p_count: 1 });
  });
});

describe("nextTokenForToday", () => {
  it("returns the RPC's token verbatim when the counter exists", async () => {
    const m = setup({ rpc: { next_token_for_day: { data: "T-07", error: null } } });
    const { nextTokenForToday } = await import("./db");
    expect(await nextTokenForToday("BAJAJ_NAGAR")).toBe("T-07");
    expect(degradedAlerts(m.tableCalls)).toHaveLength(0);
  });

  it("scopes the counter to branch AND the IST calendar day", async () => {
    const m = setup({ rpc: { next_token_for_day: { data: "T-01", error: null } } });
    const { nextTokenForToday } = await import("./db");
    await nextTokenForToday("JAGATPURA");
    expect(m.rpcCalls[0].args).toMatchObject({ p_branch: "JAGATPURA", p_date: "2026-08-03" });
  });

  it("uses the IST day, not the UTC day, during the 00:30 IST window", async () => {
    vi.setSystemTime(new Date("2026-08-03T19:00:00Z")); // 00:30 IST on the 4th
    const m = setup({ rpc: { next_token_for_day: { data: "T-01", error: null } } });
    const { nextTokenForToday } = await import("./db");
    await nextTokenForToday("BAJAJ_NAGAR");
    expect(m.rpcCalls[0].args).toMatchObject({ p_date: "2026-08-04" });
  });

  it("falls back to a zero-padded count()+1 and alerts when the RPC is missing", async () => {
    const m = setup({ table: { visits: { count: 4, error: null }, system_alerts: { error: null } } });
    const { nextTokenForToday } = await import("./db");
    expect(await nextTokenForToday("BAJAJ_NAGAR")).toBe("T-05");
    expect(degradedAlerts(m.tableCalls).length).toBeGreaterThan(0);
  });

  it("fallback pads single digits but not double digits", async () => {
    setup({ table: { visits: { count: 0, error: null }, system_alerts: { error: null } } });
    const { nextTokenForToday } = await import("./db");
    expect(await nextTokenForToday("A")).toBe("T-01");

    setup({ table: { visits: { count: 11, error: null }, system_alerts: { error: null } } });
    expect(await nextTokenForToday("A")).toBe("T-12");
  });
});

describe("collectPayment (money path — must NOT degrade)", () => {
  const input = {
    visit_id: "v1",
    patient_id: "p1",
    amount_charged: 3500,
    amount_received: 3500,
    payment_mode: "CASH" as const,
    branch: "BAJAJ_NAGAR",
  };

  it("throws instead of falling back when the atomic RPC is missing", async () => {
    const m = setup();
    const { collectPayment } = await import("./db");
    await expect(collectPayment(input)).rejects.toBeTruthy();
    // No payment row may be written outside the transaction.
    expect(m.tableCalls.filter((c) => c.table === "payments")).toHaveLength(0);
  });

  it("passes every money field through to the atomic RPC unchanged", async () => {
    const m = setup({ rpc: { collect_payment_atomic: { data: { balance: 500 }, error: null } } });
    const { collectPayment } = await import("./db");
    await collectPayment({ ...input, amount_received: 3000, credit_to_apply: 250, notes: "part" });
    expect(m.rpcCalls[0]).toMatchObject({
      name: "collect_payment_atomic",
      args: {
        p_visit_id: "v1",
        p_patient_id: "p1",
        p_amount_charged: 3500,
        p_amount_received: 3000,
        p_payment_mode: "CASH",
        p_branch: "BAJAJ_NAGAR",
        p_notes: "part",
        p_credit_to_apply: 250,
      },
    });
  });

  it("defaults credit_to_apply to 0 rather than sending null/undefined", async () => {
    const m = setup({ rpc: { collect_payment_atomic: { data: { balance: 100 }, error: null } } });
    const { collectPayment } = await import("./db");
    await collectPayment(input);
    expect((m.rpcCalls[0].args as any).p_credit_to_apply).toBe(0);
  });

  it("does not schedule follow-ups while a balance is still outstanding", async () => {
    const m = setup({ rpc: { collect_payment_atomic: { data: { balance: 500 }, error: null } } });
    const { collectPayment } = await import("./db");
    await collectPayment(input);
    expect(m.tableCalls.filter((c) => c.table === "followups")).toHaveLength(0);
  });
});

describe("addStockEntry", () => {
  it("uses the row-locked RPC when available", async () => {
    const m = setup({ rpc: { increment_stock: { data: { id: "inv-1" }, error: null } } });
    const { addStockEntry } = await import("./db");
    const res = await addStockEntry({ medicine_name: "Arnica", potency: "30", branch: "BAJAJ_NAGAR", quantity: 4 });
    expect(res.success).toBe(true);
    expect(degradedAlerts(m.tableCalls)).toHaveLength(0);
  });

  it("falls back to read-modify-write and alerts when the RPC is missing", async () => {
    const m = setup({
      table: {
        inventory: { data: { id: "inv-1", stock_drams: 10 }, error: null },
        system_alerts: { error: null },
      },
    });
    const { addStockEntry } = await import("./db");
    const res = await addStockEntry({ medicine_name: "Arnica", potency: "30", branch: "BAJAJ_NAGAR", quantity: 4 });
    expect(res.success).toBe(true);
    expect(degradedAlerts(m.tableCalls).length).toBeGreaterThan(0);
    // The racy path must at least write the correct arithmetic result.
    const update = m.tableCalls.find((c) => c.table === "inventory" && c.op === "update");
    expect(update?.payload).toMatchObject({ stock_drams: 14 });
  });
});
