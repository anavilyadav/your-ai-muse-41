// Split payments + payment idempotency suite (Area 1, 26 Aug 2026).
//
// These two features (migrations 0037 and 0025) landed with no tests at
// all, and both are money paths: a split that doesn't reach the RPC
// intact silently mis-attributes cash vs UPI on every report, and a lost
// idempotency key means a double-tap on a partial payment charges twice.
//
// Everything here asserts the EXACT arguments handed to
// collect_payment_atomic, because that argument object is the entire
// contract between the app and the money transaction.

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

function setup(
  opts: { rpc?: Record<string, MockResult | ((args: any) => MockResult)>; table?: Record<string, MockResult | (() => MockResult)> } = {},
) {
  state.mock = createSupabaseMock(opts);
  return state.mock;
}

/** A payment that leaves nothing owed, so the visit closes. */
const paidInFull = { data: { balance: 0, next_visit_date: null }, error: null };
/** A payment that still leaves a balance — visit stays open, no follow-up. */
const partiallyPaid = { data: { balance: 500, next_visit_date: null }, error: null };

const baseInput = {
  visit_id: "v-1",
  patient_id: "p-1",
  amount_charged: 3000,
  amount_received: 3000,
  payment_mode: "CASH",
  branch: "BAJAJ_NAGAR",
};

function paymentArgs(mock: ReturnType<typeof createSupabaseMock>, nth = 0) {
  const calls = mock.rpcCalls.filter((c) => c.name === "collect_payment_atomic");
  return calls[nth]?.args as Record<string, any> | undefined;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-26T06:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("collectPayment — split payments (migration 0037)", () => {
  it("passes the split rows through to the RPC untouched", async () => {
    const m = setup({ rpc: { collect_payment_atomic: partiallyPaid } });
    const { collectPayment } = await import("./db");
    await collectPayment({
      ...baseInput,
      amount_received: 3000,
      payment_mode: "SPLIT",
      splits: [
        { mode: "CASH", amount: 2000 },
        { mode: "PAYTM", amount: 1000 },
      ],
    });
    expect(paymentArgs(m)?.p_splits).toEqual([
      { mode: "CASH", amount: 2000 },
      { mode: "PAYTM", amount: 1000 },
    ]);
  });

  it("sends p_splits: null for an ordinary single-mode payment", async () => {
    // null, not [] and not undefined — the RPC branches on IS NULL to mean
    // "no breakdown, use payment_mode on the row itself".
    const m = setup({ rpc: { collect_payment_atomic: partiallyPaid } });
    const { collectPayment } = await import("./db");
    await collectPayment(baseInput);
    expect(paymentArgs(m)?.p_splits).toBeNull();
  });

  it("treats an empty split array as no split at all", async () => {
    const m = setup({ rpc: { collect_payment_atomic: partiallyPaid } });
    const { collectPayment } = await import("./db");
    await collectPayment({ ...baseInput, splits: [] });
    expect(paymentArgs(m)?.p_splits).toBeNull();
  });

  it("does not itself alter the amounts — the DB is the single authority on the exact-sum rule", async () => {
    // Deliberate: the client must not "helpfully" round or rebalance a
    // mismatched split. It ships what the user entered and lets the RPC
    // reject the whole transaction (Dr. Yadav: no rounding slack).
    const m = setup({ rpc: { collect_payment_atomic: partiallyPaid } });
    const { collectPayment } = await import("./db");
    await collectPayment({
      ...baseInput,
      amount_received: 3000,
      splits: [
        { mode: "CASH", amount: 1500 },
        { mode: "UPI", amount: 1400 },
      ],
    });
    const args = paymentArgs(m)!;
    expect(args.p_amount_received).toBe(3000);
    expect(args.p_splits).toEqual([
      { mode: "CASH", amount: 1500 },
      { mode: "UPI", amount: 1400 },
    ]);
  });

  it("propagates the RPC's rejection of a mismatched split instead of swallowing it", async () => {
    setup({
      rpc: {
        collect_payment_atomic: { error: { message: "splits (2900) must equal amount_received (3000)" } },
      },
    });
    const { collectPayment } = await import("./db");
    await expect(
      collectPayment({ ...baseInput, splits: [{ mode: "CASH", amount: 2900 }] }),
    ).rejects.toThrow(/must equal amount_received/);
  });

  it("carries credit and splits in the same single transaction", async () => {
    const m = setup({ rpc: { collect_payment_atomic: partiallyPaid } });
    const { collectPayment } = await import("./db");
    await collectPayment({
      ...baseInput,
      amount_received: 2000,
      credit_to_apply: 500,
      splits: [{ mode: "UPI", amount: 2000 }],
    });
    const args = paymentArgs(m)!;
    expect(args.p_credit_to_apply).toBe(500);
    expect(args.p_splits).toEqual([{ mode: "UPI", amount: 2000 }]);
    // One RPC call = one transaction. Two would mean credit and payment
    // could diverge.
    expect(m.rpcCalls.filter((c) => c.name === "collect_payment_atomic")).toHaveLength(1);
  });

  it("defaults credit to 0 rather than null when none is applied", async () => {
    const m = setup({ rpc: { collect_payment_atomic: partiallyPaid } });
    const { collectPayment } = await import("./db");
    await collectPayment(baseInput);
    expect(paymentArgs(m)?.p_credit_to_apply).toBe(0);
  });
});

describe("collectPayment — idempotency (migration 0025)", () => {
  it("forwards the caller's key so a retry of the same submission cannot double-charge", async () => {
    const m = setup({ rpc: { collect_payment_atomic: partiallyPaid } });
    const { collectPayment } = await import("./db");
    await collectPayment({ ...baseInput, idempotency_key: "key-abc" });
    expect(paymentArgs(m)?.p_idempotency_key).toBe("key-abc");
  });

  it("sends the identical key on a repeat submit, so the DB can recognise the duplicate", async () => {
    const m = setup({ rpc: { collect_payment_atomic: partiallyPaid } });
    const { collectPayment } = await import("./db");
    // Same screen, same key, two taps.
    await collectPayment({ ...baseInput, idempotency_key: "key-double-tap" });
    await collectPayment({ ...baseInput, idempotency_key: "key-double-tap" });
    const keys = m.rpcCalls
      .filter((c) => c.name === "collect_payment_atomic")
      .map((c) => (c.args as any).p_idempotency_key);
    expect(keys).toEqual(["key-double-tap", "key-double-tap"]);
  });

  it("omits the key entirely (not null) when the caller has none, so old RPC signatures still match", async () => {
    const m = setup({ rpc: { collect_payment_atomic: partiallyPaid } });
    const { collectPayment } = await import("./db");
    await collectPayment(baseInput);
    expect(paymentArgs(m)).not.toHaveProperty("p_idempotency_key");
  });

  it("retries WITHOUT the key and raises a degraded alert when 0025 isn't applied yet", async () => {
    // The deploy window: app code is live, the migration isn't. Losing the
    // idempotency layer for a few minutes is acceptable; failing every
    // payment at reception is not.
    let call = 0;
    const m = setup({
      rpc: {
        collect_payment_atomic: (args: any) => {
          call++;
          if ("p_idempotency_key" in args) {
            return { error: { message: "function collect_payment_atomic(...) does not exist", code: "42883" } };
          }
          return partiallyPaid;
        },
      },
      table: { system_alerts: { error: null } },
    });
    const { collectPayment } = await import("./db");
    await collectPayment({ ...baseInput, idempotency_key: "key-xyz" });
    expect(call).toBe(2);
    expect(paymentArgs(m, 1)).not.toHaveProperty("p_idempotency_key");
    // The degradation must be visible, not silent.
    expect(degradedAlerts(m.tableCalls).length).toBeGreaterThan(0);
  });

  it("does NOT retry when the RPC fails for any reason other than a missing signature", async () => {
    // A business-rule rejection (already paid, bad split, locked visit)
    // must never be retried — retrying is how you double-charge.
    const m = setup({
      rpc: { collect_payment_atomic: { error: { message: "visit already DONE", code: "P0001" } } },
    });
    const { collectPayment } = await import("./db");
    await expect(collectPayment({ ...baseInput, idempotency_key: "key-1" })).rejects.toThrow(/already DONE/);
    expect(m.rpcCalls.filter((c) => c.name === "collect_payment_atomic")).toHaveLength(1);
  });

  it("still refuses a client-side multi-step fallback when the whole RPC is missing", async () => {
    // No key given, so there is no "retry without the key" path — the
    // function must simply throw rather than inserting the payment row by
    // hand (the pre-atomic behaviour that could half-apply money).
    const m = setup({ table: { payments: { error: null }, system_alerts: { error: null } } });
    const { collectPayment } = await import("./db");
    await expect(collectPayment(baseInput)).rejects.toThrow(/does not exist/);
    expect(m.tableCalls.filter((c) => c.table === "payments")).toHaveLength(0);
  });
});

describe("collectPayment — downstream follow-up scheduling", () => {
  it("schedules follow-ups only once the balance actually reaches zero", async () => {
    const m = setup({ rpc: { collect_payment_atomic: partiallyPaid } });
    const { collectPayment } = await import("./db");
    await collectPayment(baseInput);
    expect(m.rpcCalls.map((c) => c.name)).not.toContain("reschedule_followups_atomic");
  });

  it("schedules follow-ups when the visit closes", async () => {
    const m = setup({
      rpc: { collect_payment_atomic: paidInFull, reschedule_followups_atomic: { error: null } },
      table: { followup_touchpoints: { data: [], error: null } },
    });
    const { collectPayment } = await import("./db");
    await collectPayment(baseInput);
    expect(m.rpcCalls.map((c) => c.name)).toContain("reschedule_followups_atomic");
  });

  it("reports a follow-up failure as 'payment saved but…' rather than as a failed payment", async () => {
    setup({
      rpc: {
        collect_payment_atomic: paidInFull,
        reschedule_followups_atomic: { error: { message: "followups table locked", code: "55P03" } },
      },
      table: { followup_touchpoints: { data: [], error: null } },
    });
    const { collectPayment } = await import("./db");
    // Staff must not re-collect money because a reminder row failed.
    await expect(collectPayment(baseInput)).rejects.toThrow(/Payment collect ho gaya/);
  });
});
