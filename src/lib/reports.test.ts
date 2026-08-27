// Report aggregation suite (migration 0045).
//
// WHY THIS SUITE EXISTS
// fetchReports / fetchOwnerStats / fetchDoctorDashboard / fetchWeekRevenue
// used to sum raw rows in the browser. PostgREST truncates a response at its
// max-rows cap, so past that many payments in a period the total came back
// looking normal and silently LOW. The aggregation now lives in Postgres.
//
// So the contract these tests protect is: when the RPC exists, the browser
// must NOT read the payments/visits tables at all — a single row-read on that
// path is the bug coming back. And when the RPC is missing, the old path must
// still run AND raise a degraded-mode alert, never fail quietly.

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

// payment_modes drives the labelled mode breakdown on both paths.
const MODES: MockResult = {
  data: [
    { code: "CASH", label: "Cash", is_active: true },
    { code: "UPI", label: "UPI", is_active: true },
  ],
  error: null,
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchReports — aggregate path", () => {
  it("returns the Postgres totals and never re-reads the payments table", async () => {
    const mock = setup({
      rpc: {
        report_totals: {
          data: {
            total_revenue: 1234567,
            outstanding: 8900,
            total_patients: 412,
            new_patients: 57,
            leads_converted: 9,
            by_mode: [
              { mode: "CASH", amount: 1000000 },
              { mode: "UPI", amount: 234567 },
            ],
          },
          error: null,
        },
      },
      table: { payment_modes: MODES },
    });

    const { fetchReports } = await import("./db");
    const out = await fetchReports("month");
    const rows = Object.fromEntries(out.rows);

    expect(rows["Total Revenue"]).toBe("₹12,34,567");
    expect(rows["Total Patients"]).toBe("412");
    expect(rows["New Patients"]).toBe("57");
    // 1234567 / 412 rounded — proves the average is derived from the FULL
    // total, not from a truncated page of rows.
    expect(rows["Avg per Patient"]).toBe("₹2,997");
    expect(rows["Cash Collection"]).toBe("₹10,00,000");
    expect(rows["UPI Collection"]).toBe("₹2,34,567");
    expect(rows["Outstanding"]).toBe("₹8,900");
    expect(rows["Leads Converted"]).toBe("9");

    // The whole point of 0045: zero row-level reads of the money tables.
    expect(mock.fromCalls).not.toContain("payments");
    expect(mock.fromCalls).not.toContain("visits");
    expect(mock.fromCalls).not.toContain("payment_splits");
    expect(degradedAlerts(mock.tableCalls)).toHaveLength(0);
  });

  it("passes a closed IST range and the branch filter into the RPC", async () => {
    const mock = setup({
      rpc: { report_totals: { data: { total_revenue: 0, by_mode: [] }, error: null } },
      table: { payment_modes: MODES },
    });

    const { fetchReports } = await import("./db");
    await fetchReports("custom", "BAJAJ_NAGAR", { from: "2026-08-01", to: "2026-08-15" });

    const call = mock.rpcCalls.find((c) => c.name === "report_totals");
    expect(call?.args).toEqual({
      p_start: "2026-08-01",
      p_end: "2026-08-15",
      p_branch: "BAJAJ_NAGAR",
    });
  });

  it("closes open-ended periods at today rather than sending a null end", async () => {
    const mock = setup({
      rpc: { report_totals: { data: { total_revenue: 0, by_mode: [] }, error: null } },
      table: { payment_modes: MODES },
    });

    const { fetchReports, today } = await import("./db");
    await fetchReports("year");

    const args = mock.rpcCalls.find((c) => c.name === "report_totals")?.args as any;
    expect(args.p_end).toBe(today());
    expect(args.p_branch).toBeNull();
  });

  it("falls back to the old client-side sum and raises a degraded alert when 0045 is not applied", async () => {
    const mock = setup({
      // No report_totals configured → the mock returns 42883, exactly what
      // Postgres says when the migration hasn't been run.
      table: {
        payments: { data: [{ id: "p1", amount_received: 500, balance_due: 0 }], error: null },
        visits: { data: [{ id: "v1", patient_id: "pat1" }], error: null },
        patients: { data: null, error: null, count: 1 },
        leads: { data: null, error: null, count: 0 },
        payment_modes: MODES,
        payment_splits: { data: [{ mode: "CASH", amount: 500 }], error: null },
        system_alerts: { data: null, error: null },
      },
    });

    const { fetchReports } = await import("./db");
    const rows = Object.fromEntries((await fetchReports("today")).rows);

    expect(rows["Total Revenue"]).toBe("₹500");
    expect(mock.fromCalls).toContain("payments");
    expect(degradedAlerts(mock.tableCalls)).toHaveLength(1);
  });

  it("surfaces a real error (permission denied) instead of silently falling back", async () => {
    setup({
      rpc: { report_totals: { data: null, error: { message: "permission denied for function report_totals", code: "42501" } } },
      table: { payment_modes: MODES },
    });

    const { fetchReports } = await import("./db");
    // A denied RPC must NOT quietly degrade into a possibly-truncated total.
    await expect(fetchReports("today")).rejects.toThrow();
  });
});

describe("fetchOwnerStats — aggregate path", () => {
  it("reads every headline number from owner_totals", async () => {
    const mock = setup({
      rpc: {
        owner_totals: {
          data: {
            today_visits_bajaj: 12,
            today_visits_jagatpura: 8,
            today_revenue: 45000,
            today_revenue_bajaj: 30000,
            today_revenue_jagatpura: 15000,
            month_revenue: 900000,
            new_today: 4,
            followups_today: 6,
            by_mode: [{ mode: "UPI", amount: 900000 }],
          },
          error: null,
        },
      },
      table: { payment_modes: MODES },
    });

    const { fetchOwnerStats } = await import("./db");
    const s = await fetchOwnerStats();

    expect(s.todayVisits).toBe(20);
    expect(s.todayRevenueBajaj).toBe(30000);
    expect(s.monthRevenue).toBe(900000);
    expect(s.followupsToday).toBe(6);
    // Cash stays visible at ₹0 so the split table keeps a stable shape.
    expect(s.monthByMode).toEqual([
      { mode: "CASH", label: "Cash", amount: 0 },
      { mode: "UPI", label: "UPI", amount: 900000 },
    ]);
    expect(mock.fromCalls).not.toContain("payments");
  });
});

describe("fetchDoctorDashboard — aggregate path", () => {
  it("uses doctor_totals and title-cases the top complaints", async () => {
    const mock = setup({
      rpc: {
        doctor_totals: {
          data: {
            today_seen: 11,
            today_new: 2,
            today_followups_done: 5,
            month_patients: 300,
            month_revenue: 750000,
            awaiting_rx: 3,
            top_complaints: [
              { label: "skin allergy", count: 40 },
              { label: "migraine", count: 12 },
            ],
          },
          error: null,
        },
      },
    });

    const { fetchDoctorDashboard } = await import("./db");
    const d = await fetchDoctorDashboard();

    expect(d.todaySeen).toBe(11);
    expect(d.monthPatients).toBe(300);
    expect(d.monthRevenue).toBe(750000);
    expect(d.topComplaints).toEqual([
      ["Skin allergy", 40],
      ["Migraine", 12],
    ]);
    expect(mock.fromCalls).not.toContain("visits");
  });
});

describe("fetchWeekRevenue — aggregate path", () => {
  it("maps RPC day totals onto the seven weekday buckets, zero-filling gaps", async () => {
    let requested: any;
    const mock = setup({
      rpc: {
        week_revenue: (args: any) => {
          requested = args;
          // Only the first day has money; the other six must come back as 0,
          // not as missing bars.
          return { data: [{ day: args.p_start, total: 7500 }], error: null };
        },
      },
    });

    const { fetchWeekRevenue } = await import("./db");
    const week = await fetchWeekRevenue();

    expect(week).toHaveLength(7);
    expect(week[0][1]).toBe(7500);
    expect(week.slice(1).every(([, v]) => v === 0)).toBe(true);
    expect(requested.p_start < requested.p_end).toBe(true);
    expect(mock.fromCalls).not.toContain("payments");
  });
});
