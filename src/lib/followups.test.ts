// Atomic follow-up reschedule suite (migration 0024, tested 26 Aug 2026).
//
// The bug this replaced: a separate DELETE then a separate INSERT, where a
// failed DELETE was only console.error'd and the INSERT ran anyway —
// duplicate PENDING rows, which means the patient gets the same WhatsApp
// reminder twice. These tests pin down that the atomic RPC is the only
// path taken when it exists, that the row set it receives is correct
// (including the "never in the past" rule), and that the legacy two-step
// path is reachable ONLY on a missing function and always announces
// itself.

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
  opts: { rpc?: Record<string, MockResult | ((args: any) => MockResult)>; table?: Record<string, MockResult> } = {},
) {
  state.mock = createSupabaseMock(opts);
  return state.mock;
}

const touchpoint = (over: Record<string, unknown> = {}) => ({
  id: "t-1",
  label: "3 din pehle",
  min_gap_days: 0,
  max_gap_days: 90,
  days_before_due: 3,
  channel: "WHATSAPP",
  active: true,
  ...over,
});

function rescheduleArgs(mock: ReturnType<typeof createSupabaseMock>) {
  return mock.rpcCalls.find((c) => c.name === "reschedule_followups_atomic")?.args as Record<string, any> | undefined;
}

beforeEach(() => {
  vi.useFakeTimers();
  // 10:00 IST on 26 Aug — safely mid-day so nothing here is accidentally
  // testing the midnight boundary (that lives in ist.test.ts).
  vi.setSystemTime(new Date("2026-08-26T04:30:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("generateFollowupSchedule — atomic path", () => {
  it("uses the single RPC and never touches the followups table directly", async () => {
    const m = setup({
      rpc: { reschedule_followups_atomic: { error: null } },
      table: { followup_touchpoints: { data: [touchpoint()], error: null } },
    });
    const { generateFollowupSchedule } = await import("./db");
    await generateFollowupSchedule("p-1", "v-1", "2026-09-25");

    expect(rescheduleArgs(m)).toMatchObject({ p_patient_id: "p-1", p_visit_id: "v-1" });
    // The whole point of 0024: zero client-side delete/insert round trips.
    expect(m.tableCalls.filter((c) => c.table === "followups")).toHaveLength(0);
    expect(degradedAlerts(m.tableCalls)).toHaveLength(0);
  });

  it("builds one row per matching touchpoint, dated days_before_due ahead of the visit date", async () => {
    const m = setup({
      rpc: { reschedule_followups_atomic: { error: null } },
      table: {
        followup_touchpoints: {
          data: [
            touchpoint({ id: "a", label: "7 din pehle", days_before_due: 7 }),
            touchpoint({ id: "b", label: "2 din pehle", days_before_due: 2 }),
          ],
          error: null,
        },
      },
    });
    const { generateFollowupSchedule } = await import("./db");
    await generateFollowupSchedule("p-1", "v-1", "2026-09-25");

    expect(rescheduleArgs(m)?.p_rows).toEqual([
      { due_date: "2026-09-18", followup_type: "7 din pehle", channel: "WHATSAPP" },
      { due_date: "2026-09-23", followup_type: "2 din pehle", channel: "WHATSAPP" },
    ]);
  });

  it("schedules a post-due chase row AFTER the due date for a negative days_before_due", async () => {
    const m = setup({
      rpc: { reschedule_followups_atomic: { error: null } },
      table: {
        followup_touchpoints: { data: [touchpoint({ label: "Day 5 chase", days_before_due: -5 })], error: null },
      },
    });
    const { generateFollowupSchedule } = await import("./db");
    await generateFollowupSchedule("p-1", "v-1", "2026-09-25");
    expect(rescheduleArgs(m)?.p_rows).toEqual([
      { due_date: "2026-09-30", followup_type: "Day 5 chase", channel: "WHATSAPP" },
    ]);
  });

  it("never schedules a reminder in the past — clamps to today instead", async () => {
    // Next visit is 2 days away but the rule says "7 days before": the
    // reminder date would land before today, i.e. never fire.
    const m = setup({
      rpc: { reschedule_followups_atomic: { error: null } },
      table: { followup_touchpoints: { data: [touchpoint({ days_before_due: 7 })], error: null } },
    });
    const { generateFollowupSchedule } = await import("./db");
    await generateFollowupSchedule("p-1", "v-1", "2026-08-28");
    expect(rescheduleArgs(m)?.p_rows[0].due_date).toBe("2026-08-26");
  });

  it("keeps CALL touchpoints on the CALL channel so they stay a manual worklist", async () => {
    const m = setup({
      rpc: { reschedule_followups_atomic: { error: null } },
      table: { followup_touchpoints: { data: [touchpoint({ channel: "CALL" })], error: null } },
    });
    const { generateFollowupSchedule } = await import("./db");
    await generateFollowupSchedule("p-1", "v-1", "2026-09-25");
    expect(rescheduleArgs(m)?.p_rows[0].channel).toBe("CALL");
  });

  it("ignores inactive rules and rules whose gap bracket doesn't match", async () => {
    const m = setup({
      rpc: { reschedule_followups_atomic: { error: null } },
      table: {
        followup_touchpoints: {
          data: [
            touchpoint({ id: "off", label: "disabled", active: false }),
            touchpoint({ id: "narrow", label: "short gaps only", min_gap_days: 0, max_gap_days: 5 }),
            touchpoint({ id: "ok", label: "applies", days_before_due: 1 }),
          ],
          error: null,
        },
      },
    });
    const { generateFollowupSchedule } = await import("./db");
    await generateFollowupSchedule("p-1", "v-1", "2026-09-25"); // 30-day gap
    expect(rescheduleArgs(m)?.p_rows).toEqual([
      { due_date: "2026-09-24", followup_type: "applies", channel: "WHATSAPP" },
    ]);
  });

  it("falls back to one DEFAULT row 30 days out when no next-visit date was set", async () => {
    // A patient must never end up with zero follow-up coverage.
    const m = setup({
      rpc: { reschedule_followups_atomic: { error: null } },
      table: { followup_touchpoints: { data: [], error: null } },
    });
    const { generateFollowupSchedule } = await import("./db");
    await generateFollowupSchedule("p-1", "v-1", null);
    expect(rescheduleArgs(m)?.p_rows).toEqual([
      { due_date: "2026-09-25", followup_type: "DEFAULT", channel: "WHATSAPP" },
    ]);
  });

  it("still produces a DEFAULT row when the rules table itself errors out", async () => {
    const m = setup({
      rpc: { reschedule_followups_atomic: { error: null } },
      table: { followup_touchpoints: { error: { message: "permission denied" } } },
    });
    const { generateFollowupSchedule } = await import("./db");
    await generateFollowupSchedule("p-1", "v-1", "2026-09-25");
    expect(rescheduleArgs(m)?.p_rows[0].followup_type).toBe("DEFAULT");
  });

  it("treats a garbage next-visit date the same as none, rather than emitting an invalid date", async () => {
    const m = setup({
      rpc: { reschedule_followups_atomic: { error: null } },
      table: { followup_touchpoints: { data: [], error: null } },
    });
    const { generateFollowupSchedule } = await import("./db");
    await generateFollowupSchedule("p-1", "v-1", "not-a-date");
    expect(rescheduleArgs(m)?.p_rows[0].due_date).toBe("2026-09-25");
  });
});

describe("generateFollowupSchedule — fallback path", () => {
  it("uses the legacy delete+insert ONLY when the RPC is missing, and raises a degraded alert", async () => {
    const m = setup({ table: { followup_touchpoints: { data: [], error: null }, followups: { error: null }, system_alerts: { error: null } } });
    const { generateFollowupSchedule } = await import("./db");
    await generateFollowupSchedule("p-1", "v-1", "2026-09-25");

    const followupOps = m.tableCalls.filter((c) => c.table === "followups").map((c) => c.op);
    expect(followupOps).toEqual(["delete", "insert"]);
    expect(degradedAlerts(m.tableCalls).length).toBeGreaterThan(0);
  });

  it("writes full rows (patient, visit, PENDING status) on the fallback path", async () => {
    const m = setup({ table: { followup_touchpoints: { data: [], error: null }, followups: { error: null }, system_alerts: { error: null } } });
    const { generateFollowupSchedule } = await import("./db");
    await generateFollowupSchedule("p-9", "v-9", "2026-09-25");

    const insert = m.tableCalls.find((c) => c.table === "followups" && c.op === "insert")!;
    expect(insert.payload).toEqual([
      {
        patient_id: "p-9",
        visit_id: "v-9",
        due_date: "2026-09-25",
        followup_type: "DEFAULT",
        channel: "WHATSAPP",
        status: "PENDING",
      },
    ]);
  });

  it("rethrows a real RPC error instead of quietly degrading to the racy path", async () => {
    // A locked table or a constraint violation is NOT "migration pending".
    const m = setup({
      rpc: { reschedule_followups_atomic: { error: { message: "deadlock detected", code: "40P01" } } },
      table: { followup_touchpoints: { data: [], error: null }, followups: { error: null } },
    });
    const { generateFollowupSchedule } = await import("./db");
    await expect(generateFollowupSchedule("p-1", "v-1", "2026-09-25")).rejects.toThrow(/deadlock/);
    expect(m.tableCalls.filter((c) => c.table === "followups")).toHaveLength(0);
  });

  it("throws when the fallback insert fails, so 'no follow-up coverage' can never pass silently", async () => {
    setup({
      table: {
        followup_touchpoints: { data: [], error: null },
        followups: { error: { message: "insert denied" } },
        system_alerts: { error: null },
      },
    });
    const { generateFollowupSchedule } = await import("./db");
    await expect(generateFollowupSchedule("p-1", "v-1", "2026-09-25")).rejects.toThrow(/insert denied/);
  });
});
