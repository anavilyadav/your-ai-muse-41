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
export type LeadStatus = "HOT" | "Warm" | "Cold" | "Converted" | "Lost";
export async function fetchLeads() {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return [];
  return data ?? [];
}
export async function updateLeadStatus(id: string, status: LeadStatus) {
  await supabase.from("leads").update({ status }).eq("id", id);
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

export interface StockEntryInput {
  medicine_name: string;
  potency: string;
  branch: string;
  quantity: number;
  type?: string;
}

/** Adds stock: if a row for this medicine+potency+branch exists, increments it; else creates it. */
export async function addStockEntry(input: StockEntryInput) {
  const { data: existing } = await supabase
    .from("inventory")
    .select("id, stock_drams")
    .eq("medicine_name", input.medicine_name)
    .eq("potency", input.potency)
    .eq("branch", input.branch)
    .maybeSingle();

  if (existing?.id) {
    const newStock = Number(existing.stock_drams ?? 0) + input.quantity;
    const { error } = await supabase.from("inventory").update({ stock_drams: newStock }).eq("id", existing.id);
    if (error) return { success: false, error: error.message };
    return { success: true, error: null };
  }
  const { error } = await supabase.from("inventory").insert({
    medicine_name: input.medicine_name,
    potency: input.potency,
    branch: input.branch,
    stock_drams: input.quantity,
    type: input.type ?? null,
  });
  if (error) return { success: false, error: error.message };
  return { success: true, error: null };
}

export async function fetchMasterMedicines() {
  const { data } = await supabase
    .from("inventory")
    .select("medicine_name, potency, type")
    .order("medicine_name", { ascending: true });
  const map = new Map<string, { med: string; potencies: string[]; type: string }>();
  (data ?? []).forEach((r: any) => {
    const cur: { med: string; potencies: string[]; type: string } =
      map.get(r.medicine_name) ?? { med: r.medicine_name, potencies: [], type: r.type ?? "" };
    if (r.potency && !cur.potencies.includes(r.potency)) cur.potencies.push(r.potency);
    if (r.type && !cur.type) cur.type = r.type;
    map.set(r.medicine_name, cur);
  });
  return Array.from(map.values());
}

// ---------- Dispense ----------
export async function fetchVisitPrescriptions(visitId: string) {
  const { data } = await supabase
    .from("prescriptions")
    .select("*")
    .eq("visit_id", visitId)
    .order("created_at", { ascending: true });
  return (data ?? []) as DBPrescription[];
}

export async function markDispensed(visitId: string) {
  await supabase.from("visits").update({ visit_status: "PAYMENT" }).eq("id", visitId);
}

// ---------- Case notes ----------
export async function saveCaseNotes(visitId: string, notes: string) {
  await supabase
    .from("visits")
    .update({ visit_status: "WAITING_DOCTOR", doctor_notes: notes })
    .eq("id", visitId);
}

// ---------- Owner ----------
export async function fetchOwnerStats() {
  const t = today();
  const monthStart = t.slice(0, 8) + "01";
  const [todayVisitsBajaj, todayVisitsJagatpura, todayPay, monthPay, newToday, followupsToday] =
    await Promise.all([
      supabase.from("visits").select("id", { count: "exact", head: true }).eq("visit_date", t).eq("branch", "BAJAJ_NAGAR"),
      supabase.from("visits").select("id", { count: "exact", head: true }).eq("visit_date", t).eq("branch", "JAGATPURA"),
      supabase.from("payments").select("amount_received,payment_mode,branch").gte("created_at", t),
      supabase.from("payments").select("amount_received,payment_mode,branch").gte("created_at", monthStart),
      supabase.from("patients").select("id", { count: "exact", head: true }).gte("created_at", t),
      supabase.from("followups").select("id", { count: "exact", head: true }).eq("status", "PENDING").lte("due_date", t),
    ]);
  const sum = (rows: any[] | null, filt?: (r: any) => boolean) =>
    (rows ?? []).filter((r) => (filt ? filt(r) : true)).reduce((s, r) => s + Number(r.amount_received ?? 0), 0);
  return {
    todayVisits: (todayVisitsBajaj.count ?? 0) + (todayVisitsJagatpura.count ?? 0),
    todayVisitsBajaj: todayVisitsBajaj.count ?? 0,
    todayVisitsJagatpura: todayVisitsJagatpura.count ?? 0,
    todayRevenue: sum(todayPay.data),
    todayRevenueBajaj: sum(todayPay.data, (r) => r.branch === "BAJAJ_NAGAR"),
    todayRevenueJagatpura: sum(todayPay.data, (r) => r.branch === "JAGATPURA"),
    monthRevenue: sum(monthPay.data),
    monthCash: sum(monthPay.data, (r) => r.payment_mode === "CASH"),
    monthUpi: sum(monthPay.data, (r) => r.payment_mode === "UPI"),
    monthCard: sum(monthPay.data, (r) => r.payment_mode === "CARD"),
    newToday: newToday.count ?? 0,
    followupsToday: followupsToday.count ?? 0,
  };
}

export async function fetchWeekRevenue() {
  const days: { d: string; label: string }[] = [];
  const now = new Date();
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(now);
    dt.setDate(now.getDate() - i);
    days.push({ d: dt.toISOString().slice(0, 10), label: labels[dt.getDay()] });
  }
  const start = days[0].d;
  const { data } = await supabase
    .from("payments")
    .select("amount_received,created_at")
    .gte("created_at", start);
  return days.map((day) => {
    const total = (data ?? [])
      .filter((r: any) => (r.created_at ?? "").slice(0, 10) === day.d)
      .reduce((s: number, r: any) => s + Number(r.amount_received ?? 0), 0);
    return [day.label, total] as [string, number];
  });
}

export async function fetchReports(period: "week" | "month" | "lastMonth" | "year", branch?: string) {
  const now = new Date();
  let start: string;
  let end: string | null = null;
  if (period === "week") {
    const d = new Date(now); d.setDate(now.getDate() - 6);
    start = d.toISOString().slice(0, 10);
  } else if (period === "month") {
    start = now.toISOString().slice(0, 8) + "01";
  } else if (period === "lastMonth") {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const e = new Date(now.getFullYear(), now.getMonth(), 0);
    start = d.toISOString().slice(0, 10);
    end = e.toISOString().slice(0, 10);
  } else {
    start = now.getFullYear() + "-01-01";
  }
  let payQ = supabase.from("payments").select("amount_received,amount_charged,balance_due,payment_mode").gte("created_at", start);
  let visQ = supabase.from("visits").select("id,patient_id").gte("visit_date", start);
  let patQ = supabase.from("patients").select("id", { count: "exact", head: true }).gte("created_at", start);
  let leadQ = supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "Converted").gte("created_at", start);
  if (branch) {
    payQ = payQ.eq("branch", branch);
    visQ = visQ.eq("branch", branch);
    patQ = patQ.eq("branch", branch);
  }
  if (end) {
    payQ = payQ.lte("created_at", end + "T23:59:59");
    visQ = visQ.lte("visit_date", end);
    patQ = patQ.lte("created_at", end + "T23:59:59");
    leadQ = leadQ.lte("created_at", end + "T23:59:59");
  }
  const [pay, vis, pat, lead] = await Promise.all([payQ, visQ, patQ, leadQ]);
  const rows = pay.data ?? [];
  const sum = (f: (r: any) => number) => rows.reduce((s, r) => s + f(r), 0);
  const totalRev = sum((r) => Number(r.amount_received ?? 0));
  const outstanding = sum((r) => Number(r.balance_due ?? 0));
  const cash = sum((r) => (r.payment_mode === "CASH" ? Number(r.amount_received ?? 0) : 0));
  const upi = sum((r) => (r.payment_mode === "UPI" ? Number(r.amount_received ?? 0) : 0));
  const card = sum((r) => (r.payment_mode === "CARD" ? Number(r.amount_received ?? 0) : 0));
  const totalPatients = new Set((vis.data ?? []).map((v: any) => v.patient_id)).size;
  const newPatients = pat.count ?? 0;
  const avg = totalPatients ? Math.round(totalRev / totalPatients) : 0;
  return {
    rows: [
      ["Total Revenue", `₹${totalRev.toLocaleString("en-IN")}`],
      ["Total Patients", String(totalPatients)],
      ["New Patients", String(newPatients)],
      ["Avg per Patient", `₹${avg.toLocaleString("en-IN")}`],
      ["Cash Collection", `₹${cash.toLocaleString("en-IN")}`],
      ["UPI Collection", `₹${upi.toLocaleString("en-IN")}`],
      ["Card Collection", `₹${card.toLocaleString("en-IN")}`],
      ["Outstanding", `₹${outstanding.toLocaleString("en-IN")}`],
      ["Leads Converted", String(lead.count ?? 0)],
    ] as [string, string][],
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

export interface NewStaffInput {
  name: string;
  mobile: string;
  role: string;
  branch: string | null;
}

/**
 * Adds a staff PROFILE row to the "users" table only. This does NOT create
 * their login (Supabase Auth requires an email+password account, which
 * needs a service-role key and can't be done from the browser). After
 * running this, the login account must be created once via the
 * create-staff-login Edge Function (see supabase/functions/create-staff-login)
 * or manually in the Supabase dashboard, matching mobile@yhcos.in + PIN.
 */
export async function addStaffProfile(input: NewStaffInput) {
  const { data, error } = await supabase
    .from("users")
    .insert({ name: input.name, mobile: input.mobile, role: input.role, branch: input.branch })
    .select()
    .single();
  if (error) return { success: false, error: error.message, data: null };
  return { success: true, error: null, data };
}

export async function runHealthChecks() {
  const results: { label: string; ok: boolean; detail: string }[] = [];

  try {
    const { error } = await supabase.from("settings").select("id").limit(1);
    results.push({ label: "Supabase connectivity", ok: !error, detail: error ? error.message : "Connected" });
  } catch (e: any) {
    results.push({ label: "Supabase connectivity", ok: false, detail: String(e?.message ?? e) });
  }

  const tables = ["patients", "visits", "prescriptions", "payments", "users", "inventory"];
  for (const t of tables) {
    try {
      const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true });
      results.push({
        label: `Table: ${t}`,
        ok: !error,
        detail: error ? error.message : `${count ?? 0} rows`,
      });
    } catch (e: any) {
      results.push({ label: `Table: ${t}`, ok: false, detail: String(e?.message ?? e) });
    }
  }

  return results;
}

// ---------- Settings ----------
export async function fetchSettings() {
  const { data } = await supabase.from("settings").select("*");
  return data ?? [];
}

/** Manual incentive split: { [userId]: percentageWeight }. Stored as one JSON blob in settings. */
export async function fetchIncentiveSplits(): Promise<Record<string, number>> {
  const { data } = await supabase.from("settings").select("value").eq("key", "incentive_splits").maybeSingle();
  if (!data?.value) return {};
  try {
    return JSON.parse(data.value);
  } catch {
    return {};
  }
}

export async function saveIncentiveSplits(splits: Record<string, number>) {
  await upsertSetting("incentive_splits", JSON.stringify(splits));
}

export async function upsertSetting(key: string, value: string) {
  const { data } = await supabase.from("settings").select("id").eq("key", key).maybeSingle();
  if (data?.id) {
    await supabase.from("settings").update({ value }).eq("id", data.id);
  } else {
    await supabase.from("settings").insert({ key, value });
  }
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

export async function fetchPatientById(id: string) {
  const { data, error } = await supabase
    .from("patients")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return null;
  return data as DBPatient | null;
}

export async function fetchDaySummary(branch?: string) {
  const t = today();
  let visQ = supabase.from("visits").select("id,patient_id,visit_status,branch").eq("visit_date", t);
  let payQ = supabase.from("payments").select("amount_received,amount_charged,balance_due,branch,payment_mode").gte("created_at", t);
  if (branch) {
    visQ = visQ.eq("branch", branch);
    payQ = payQ.eq("branch", branch);
  }
  const [visRes, payRes] = await Promise.all([visQ, payQ]);
  const visits = visRes.data ?? [];
  const pays = payRes.data ?? [];
  const patientIds = visits.map((v: any) => v.patient_id).filter(Boolean);
  let newCount = 0;
  let followupCount = 0;
  if (patientIds.length) {
    const { data: pats } = await supabase
      .from("patients")
      .select("id,created_at")
      .in("id", patientIds);
    (pats ?? []).forEach((p: any) => {
      if ((p.created_at ?? "").slice(0, 10) === t) newCount++;
      else followupCount++;
    });
  }
  const revenue = pays.reduce((s, r: any) => s + Number(r.amount_received ?? 0), 0);
  const outstanding = pays.reduce((s, r: any) => s + Number(r.balance_due ?? 0), 0);
  const cash = pays.filter((r: any) => r.payment_mode === "CASH").reduce((s, r: any) => s + Number(r.amount_received ?? 0), 0);
  const upi = pays.filter((r: any) => r.payment_mode === "UPI").reduce((s, r: any) => s + Number(r.amount_received ?? 0), 0);
  const card = pays.filter((r: any) => r.payment_mode === "CARD").reduce((s, r: any) => s + Number(r.amount_received ?? 0), 0);
  return {
    totalPatients: visits.length,
    newPatients: newCount,
    followupPatients: followupCount,
    done: visits.filter((v: any) => v.visit_status === "DONE").length,
    waiting: visits.filter((v: any) => ["REGISTERED", "CASE_TAKING", "WAITING", "WAITING_DOCTOR"].includes(v.visit_status)).length,
    pendingPayments: visits.filter((v: any) => v.visit_status === "PAYMENT").length,
    revenue,
    outstanding,
    cash,
    upi,
    card,
    bajaj: visits.filter((v: any) => v.branch === "BAJAJ_NAGAR").length,
    jagat: visits.filter((v: any) => v.branch === "JAGATPURA").length,
  };
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

export function maskMobile(m: string | null | undefined): string {
  if (!m) return "";
  const s = String(m);
  if (s.length < 6) return s;
  return s.slice(0, 2) + "XXXX" + s.slice(-4);
}

