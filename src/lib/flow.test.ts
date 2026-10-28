import { describe, expect, it } from "vitest";
import { summarizeFlow } from "./flow";

const v = (token: string | null, visit_status: string) => ({ token_number: token, visit_status });

describe("summarizeFlow", () => {
  it("puts each patient in the stage of their status", () => {
    const s = summarizeFlow([v("T-01", "REGISTERED"), v("T-02", "CASE_TAKING"), v("T-03", "WAITING_DOCTOR"), v("T-04", "PHARMACY"), v("T-05", "PAYMENT"), v("T-06", "DONE")]);
    expect(s.map((x) => [x.stage.key, x.count])).toEqual([["booked", 0], ["arrived", 0], ["waiting", 1], ["case", 1], ["doctor", 1], ["pharmacy", 1], ["payment", 1], ["done", 1]]);
  });

  it("serves the lowest token first, numerically (T-2 before T-10)", () => {
    const s = summarizeFlow([v("T-10", "REGISTERED"), v("T-02", "REGISTERED"), v("T-03", "WAITING")]);
    const waiting = s.find((x) => x.stage.key === "waiting")!;
    expect(waiting.tokens).toEqual(["T-02", "T-03", "T-10"]);
    expect(waiting.current).toBe("T-02");
  });

  it("splits Arrived (marked by reception) from Waiting Area (not yet marked)", () => {
    const s = summarizeFlow([
      { token_number: "T-01", visit_status: "REGISTERED", arrived_at: "2026-10-28T10:00:00Z" },
      { token_number: "T-02", visit_status: "REGISTERED", arrived_at: null },
      { token_number: "T-03", visit_status: "WAITING", arrived_at: null },
    ]);
    expect(s.find((x) => x.stage.key === "arrived")!.tokens).toEqual(["T-01"]);
    expect(s.find((x) => x.stage.key === "waiting")!.tokens).toEqual(["T-02", "T-03"]);
  });

  it("lists today's booked appointments first, by time", () => {
    const s = summarizeFlow([], [{ appointment_time: "11:30 AM" }, { appointment_time: "10:00 AM" }]);
    expect(s[0].stage.key).toBe("booked");
    expect(s[0].count).toBe(2);
    expect(s[0].tokens).toEqual(["10:00 AM", "11:30 AM"]);
  });

  it("groups WAITING_DOCTOR and PRESCRIBED under the doctor", () => {
    const doctor = summarizeFlow([v("T-01", "PRESCRIBED"), v("T-02", "WAITING_DOCTOR")]).find((x) => x.stage.key === "doctor")!;
    expect(doctor.count).toBe(2);
  });

  it("has no current token for an empty stage and tolerates a missing token", () => {
    const s = summarizeFlow([v(null, "PHARMACY")]);
    expect(s.find((x) => x.stage.key === "case")!.current).toBeNull();
    expect(s.find((x) => x.stage.key === "pharmacy")!.tokens).toEqual(["—"]);
  });
});
