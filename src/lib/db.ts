import { supabase, today } from "./supabase";

// ---------- Types (loose — matches DB shape) ----------
export interface DBPatient {
  id: string;
  patient_code: string | null;
  name: string;
  mobile: string;
  age: number | null;
  gender: string | null;
  blood_group: string | null;
  city: string | null;
  pincode: string | null;
  primary_disease: string | null;
  wa_consent: boolean;
  branch: string;
  lifetime_visits: number;
  lifetime_revenue: number;
  current_balance: number;
  last_visit_date: string | null;
}

export interface DBVisit {
  id: string;
  patient_id: string;
  visit_date: string;
  visit_type: string;
  visit_status: string;
  token_number: string | null;
  branch: string;
  chief_complaint: string | null;
  doctor_notes: string | null;
  next_visit_date: string | null;
  created_at: string;
}

export interface DBPrescription {
  id: string;
  visit_id: string;
  patient_id: string;
  medicine_name: string;
  potency: string | null;
  dose: string | null;
  frequency: string | null;
  duration_days: number | null;
  is_slx: boolean;
  remarks: string | null;
  created_at: string;
}

// ---------- Patient registration ----------
export async function nextPatientCode(): Promise<string> {
  const { count } = await supabase.from("patients").select("id", { count: "exact", head: true });
  return `YHC-${1000 + (count ?? 0) + 1}`;
}

export async function nextTokenForToday(branch: string): Promise<string> {
  const { count } = await supabase
    .from("visits")
    .select("id", { count: "exact", head: true })
    .eq("visit_date", today())
    .eq("branch", branch);
  const n = (count ?? 0) + 1;
  return `T-${String(n).padStart(2, "0")}`;
}

export async function createPatientWithVisit(input: {
  name: string;
  mobile: string;
  age?: number;
  gender?: string;
  blood_group?: string;
  city?: string;
  pincode?: string;
  primary_disease?: string;
  wa_consent: boolean;
  branch: "BAJAJ_NAGAR" | "JAGATPURA";
  chief_complaint?: string;
}) {
  const code = await nextPatientCode();
  const token = await nextTokenForToday(input.branch);
  const { data: p, error: pe } = await supabase
    .from("patients")
    .insert({
      patient_code: code,
      name: input.name,
      mobile: input.mobile,
      age: input.age ?? null,
      gender: input.gender ?? null,
      blood_group: input.blood_group ?? null,
      city: input.city ?? null,
      pincode: input.pincode ?? null,
      primary_disease: input.primary_disease ?? null,
      wa_consent: input.wa_consent,
      branch: input.branch,
      lifetime_visits: 1,
    })
    .select("*")
    .maybeSingle();
  if (pe || !p) throw pe ?? new Error("Failed to create patient");

  const { data: v, error: ve } = await supabase
    .from("visits")
    .insert({
      patient_id: p.id,
      visit_date: today(),
      visit_type: "OPD",
      visit_status: "REGISTERED",
      token_number: token,
      branch: input.branch,
      chief_complaint: input.chief_complaint ?? null,
    })
    .select("*")
    .maybeSingle();
  if (ve || !v) throw ve ?? new Error("Failed to create visit");

  return { patient: p as DBPatient, visit: v as DBVisit };
}

export async function isDuplicateMobile(mobile: string): Promise<boolean> {
  if (mobile.length !== 10) return false;
  const { count } = await supabase
    .from("patients")
    .select("id", { count: "exact", head: true })
    .eq("mobile", mobile);
  return (count ?? 0) > 0;
}

// ---------- Queue reads ----------
export async function fetchTodayQueue() {
  const { data, error } = await supabase
    .from("visits")
    .select("*, patient:patients(*)")
    .eq("visit_date", today())
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as (DBVisit & { patient: DBPatient })[];
}

export async function fetchVisit(visitId: string) {
  const { data, error } = await supabase
    .from("visits")
    .select("*, patient:patients(*)")
    .eq("id", visitId)
    .maybeSingle();
  if (error) throw error;
  return data as (DBVisit & { patient: DBPatient }) | null;
}

// ---------- Payments ----------
export async function collectPayment(input: {
  visit_id: string;
  patient_id: string;
  amount_charged: number;
  amount_received: number;
  payment_mode: "CASH" | "UPI" | "CARD";
  branch: string;
  notes?: string;
}) {
  const balance = Math.max(0, input.amount_charged - input.amount_received);
  const { error: pe } = await supabase.from("payments").insert({
    visit_id: input.visit_id,
    patient_id: input.patient_id,
    amount_charged: input.amount_charged,
    amount_received: input.amount_received,
    balance_due: balance,
    payment_mode: input.payment_mode,
    branch: input.branch,
    notes: input.notes ?? null,
  });
  if (pe) throw pe;

  // update patient totals
  const { data: pat } = await supabase
    .from("patients")
    .select("lifetime_revenue,current_balance")
    .eq("id", input.patient_id)
    .maybeSingle();
  const newRev = Number(pat?.lifetime_revenue ?? 0) + input.amount_received;
  await supabase
    .from("patients")
    .update({ lifetime_revenue: newRev, current_balance: balance })
    .eq("id", input.patient_id);

  // update visit + create followup if fully paid
  if (balance === 0) {
    await supabase.from("visits").update({ visit_status: "DONE" }).eq("id", input.visit_id);
    const due = new Date();
    due.setDate(due.getDate() + 30);
    await supabase.from("followups").insert({
      patient_id: input.patient_id,
      visit_id: input.visit_id,
      due_date: due.toISOString().slice(0, 10),
      followup_type: "30D",
      status: "PENDING",
    });
  } else {
    await supabase.from("visits").update({ visit_status: "PAYMENT" }).eq("id", input.visit_id);
  }
}

// ---------- Prescriptions ----------
export async function fetchInventorySearch(term: string) {
  const q = supabase.from("inventory").select("*").limit(20);
  const { data, error } = term
    ? await q.ilike("medicine_name", `%${term}%`)
    : await q;
  if (error) return [];
  return data ?? [];
}

export async function fetchPatientHistory(patientId: string, limit = 3) {
  const { data: visits } = await supabase
    .from("visits")
    .select("*")
    .eq("patient_id", patientId)
    .order("visit_date", { ascending: false })
    .limit(limit);
  if (!visits || visits.length === 0) return [];
  const ids = visits.map((v: any) => v.id);
  const { data: rx } = await supabase
    .from("prescriptions")
    .select("*")
    .in("visit_id", ids);
  return visits.map((v: any) => ({
    ...v,
    prescriptions: (rx ?? []).filter((r: any) => r.visit_id === v.id),
  }));
}

export interface RxRow {
  medicine_name: string;
  potency: string;
  dose: string;
  frequency: string;
  duration_days: number;
  is_slx: boolean;
}

export async function submitPrescription(input: {
  visit_id: string;
  patient_id: string;
  rows: RxRow[];
  doctor_notes: string;
  next_visit_date: string | null;
}) {
  if (input.rows.length === 0) throw new Error("Add at least one medicine");
  const { error: re } = await supabase.from("prescriptions").insert(
    input.rows.map((r) => ({
      visit_id: input.visit_id,
      patient_id: input.patient_id,
      medicine_name: r.medicine_name,
      potency: r.potency,
      dose: r.dose,
      frequency: r.frequency,
      duration_days: r.duration_days,
      is_slx: r.is_slx,
    })),
  );
  if (re) throw re;
  await supabase
    .from("visits")
    .update({
      visit_status: "PHARMACY",
      doctor_notes: input.doctor_notes,
      next_visit_date: input.next_visit_date,
    })
    .eq("id", input.visit_id);
  await supabase
    .from("patients")
    .update({ last_visit_date: today() })
    .eq("id", input.patient_id);
}

// ---------- Follow-ups ----------
export async function fetchFollowups() {
  const { data, error } = await supabase
    .from("followups")
    .select("*, patient:patients(*)")
    .eq("status", "PENDING")
    .lte("due_date", today())
    .order("due_date", { ascending: true });
  if (error) return [];
  return data ?? [];
}

export async function markFollowupDone(id: string) {
  await supabase.from("followups").update({ status: "DONE" }).eq("id", id);
}

// ---------- Leads ----------
export async function fetchLeads() {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return [];
  return data ?? [];
}

// ---------- Inventory ----------
export async function fetchInventory() {
  const { data, error } = await supabase
    .from("inventory")
    .select("*")
    .order("medicine_name", { ascending: true });
  if (error) return [];
  return data ?? [];
}

// ---------- Owner ----------
export async function fetchOwnerStats() {
  const t = today();
  const monthStart = t.slice(0, 8) + "01";
  const [todayVisits, todayPay, monthPay] = await Promise.all([
    supabase.from("visits").select("id", { count: "exact", head: true }).eq("visit_date", t),
    supabase.from("payments").select("amount_received").gte("created_at", t),
    supabase.from("payments").select("amount_received").gte("created_at", monthStart),
  ]);
  const sum = (rows: any[] | null) =>
    (rows ?? []).reduce((s, r) => s + Number(r.amount_received ?? 0), 0);
  return {
    todayVisits: todayVisits.count ?? 0,
    todayRevenue: sum(todayPay.data),
    monthRevenue: sum(monthPay.data),
  };
}

export async function fetchStaff() {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("role", { ascending: true });
  if (error) return [];
  return data ?? [];
}

// ---------- Settings ----------
export async function fetchSettings() {
  const { data } = await supabase.from("settings").select("*");
  return data ?? [];
}

export async function updateSetting(key: string, value: string) {
  await supabase.from("settings").update({ value }).eq("key", key);
}

// ---------- Search ----------
export async function searchPatients(term: string) {
  const t = term.trim();
  if (!t) return [];
  const like = `%${t}%`;
  const { data, error } = await supabase
    .from("patients")
    .select("*")
    .or(`name.ilike.${like},mobile.ilike.${like},patient_code.ilike.${like}`)
    .limit(30);
  if (error) return [];
  return data ?? [];
}

export function branchLabel(b: string | null | undefined): string {
  if (b === "BAJAJ_NAGAR") return "Bajaj Nagar";
  if (b === "JAGATPURA") return "Jagatpura";
  return b ?? "";
}

export function statusLabel(s: string): string {
  const map: Record<string, string> = {
    REGISTERED: "Waiting",
    CASE_TAKING: "Case Taking",
    WAITING: "Waiting",
    WAITING_DOCTOR: "Waiting",
    PRESCRIBED: "Prescribed",
    PHARMACY: "Pharmacy",
    PAYMENT: "Pay Due",
    DONE: "Done",
  };
  return map[s] ?? s;
}
