// Where every patient is in today's flow, for the "Live Flow" strip shown on
// every role's queue (Dr. Yadav, 23 Oct 2026: everyone should see which
// stage each patient is at and which number is running now — reception
// enters, the next people along the line must know).
//
// visit_status follows REGISTERED -> CASE_TAKING -> WAITING_DOCTOR ->
// (PRESCRIBED) -> PHARMACY -> PAYMENT -> DONE. A follow-up patient skips case
// taking and goes from REGISTERED straight to the doctor.

export interface FlowStage {
  key: string;
  label: string;
  /** Who is expected to act on a patient in this stage. */
  owner: string;
  statuses: string[];
}

// "Arrived" = reception has marked the patient as arrived (arrived_at set);
// "Waiting Area" = registered and token given, not yet marked arrived. Both
// are before case taking, so both use the REGISTERED / WAITING statuses.
export const FLOW_STAGES: FlowStage[] = [
  { key: "arrived", label: "Arrived", owner: "Reception / Case-DR", statuses: ["REGISTERED", "WAITING"] },
  { key: "waiting", label: "Waiting Area", owner: "Reception / Case-DR", statuses: ["REGISTERED", "WAITING"] },
  { key: "case", label: "Case Taking", owner: "Case-DR", statuses: ["CASE_TAKING"] },
  { key: "doctor", label: "Doctor", owner: "Doctor", statuses: ["WAITING_DOCTOR", "PRESCRIBED"] },
  { key: "pharmacy", label: "Pharmacy", owner: "Pharmacy", statuses: ["PHARMACY"] },
  { key: "payment", label: "Payment", owner: "Reception", statuses: ["PAYMENT"] },
  { key: "done", label: "Done", owner: "", statuses: ["DONE"] },
];

export interface FlowVisit {
  token_number: string | null;
  visit_status: string;
  created_at?: string | null;
  arrived_at?: string | null;
}

export interface FlowStageSummary {
  stage: FlowStage;
  count: number;
  /** Tokens in this stage, the one being served now first. */
  tokens: string[];
  /** The token being served now (lowest number waiting in this stage). */
  current: string | null;
}

function tokenOrder(t: string | null): number {
  const m = String(t ?? "").match(/(\d+)/);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

export function summarizeFlow(visits: FlowVisit[]): FlowStageSummary[] {
  return FLOW_STAGES.map((stage) => {
    const inStage = visits
      .filter((v) => stage.statuses.includes(v.visit_status))
      .filter((v) => (stage.key === "arrived" ? !!v.arrived_at : stage.key === "waiting" ? !v.arrived_at : true))
      .sort((a, b) => tokenOrder(a.token_number) - tokenOrder(b.token_number));
    const tokens = inStage.map((v) => v.token_number ?? "—");
    return { stage, count: inStage.length, tokens, current: tokens[0] ?? null };
  });
}
