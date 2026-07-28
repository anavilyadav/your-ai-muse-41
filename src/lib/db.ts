import { supabase, today } from "./supabase";

// ---------- Types (loose — matches DB shape) ----------
export interface DBPatient {
  id: string;
  patient_code: string | null;
  name: string;
  mobile: string;
  mobile_country_code: string;
  whatsapp_country_code: string | null;
  whatsapp_number: string | null;
  age: number | null;
  gender: string | null;
  blood_group: string | null;
  city: string | null;
  pincode: string | null;
  address: string | null;
  primary_disease: string | null;
  wa_consent: boolean;
  dob: string | null;
  anniversary_date: string | null;
  profession: string | null;
  annual_income: number | null;
  card_number: string | null;
  card_register: string | null;
  branch: string;
  lifetime_visits: number;
  lifetime_revenue: number;
  current_balance: number;
  last_visit_date: string | null;
  family_group_id: string | null;
  family_relationship: string | null;
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

// ---------- International phone number handling ----------
// ---------- Lead → Patient auto-conversion ----------
// "Converted" used to be a manual status label only — nothing actually
// linked the lead to the patient record it became, so nurture messages
// had no way to know to stop. This closes that gap: whenever a patient
// registers, any lead sitting on the same mobile number gets flipped and
// linked automatically. Best-effort — a lead-matching hiccup must never
// block a real registration that already succeeded.
export async function autoConvertMatchingLead(patientId: string, mobile: string): Promise<void> {
  try {
    await supabase
      .from("leads")
      .update({ status: "Converted", converted_patient_id: patientId })
      .eq("mobile", mobile)
      .neq("status", "Converted");
  } catch {
    // non-fatal
  }
}

// ---------- Returning patient check-in ----------
// Until now the ONLY way to create a visit was createPatientWithVisit,
// which also creates a brand-new patient — so a returning patient hit a
// dead-end "already registered" block with no way forward. This is the
// missing other half: find the existing patient, create just a new visit
// for them (no duplicate patient record), and since they've now actually
// walked in, resolve any pending follow-ups for them automatically so
// reminders don't keep going out to someone who's already here.
export async function findPatientByMobile(mobile: string, countryCode: string = "+91"): Promise<{ id: string; name: string; patient_code: string | null } | null> {
  const { data } = await supabase
    .from("patients")
    .select("id, name, patient_code")
    .eq("mobile", mobile)
    .eq("mobile_country_code", countryCode)
    .maybeSingle();
  return data ?? null;
}

export async function checkInExistingPatient(input: {
  patient_id: string;
  branch: "BAJAJ_NAGAR" | "JAGATPURA";
  chief_complaint?: string;
}): Promise<{ visit: DBVisit }> {
  const token = await nextTokenForToday(input.branch);
  const { data: v, error: ve } = await supabase
    .from("visits")
    .insert({
      patient_id: input.patient_id,
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

  // Best-effort — a visit was already created successfully above, so a
  // hiccup in either of these must never surface as a check-in failure.
  try {
    const { data: p } = await supabase.from("patients").select("lifetime_visits").eq("id", input.patient_id).maybeSingle();
    await supabase.from("patients").update({ lifetime_visits: (p?.lifetime_visits ?? 0) + 1 }).eq("id", input.patient_id);
  } catch {
    // non-fatal
  }
  try {
    // Item #8: patient is physically here now, so any reminder still
    // pending for them is moot — stop it from firing later today.
    await supabase.from("followups").update({ status: "DONE" }).eq("patient_id", input.patient_id).eq("status", "PENDING");
  } catch {
    // non-fatal
  }

  return { visit: v as DBVisit };
}

// India (+91) stays exactly as before — AiSensy already auto-prepends 91
// for a bare 10-digit number, and that's live/working, so we don't touch
// it. Any other country code gets the digits prefixed explicitly, since
// AiSensy has no way to guess a non-Indian country from local digits alone.
export function buildWhatsAppDestination(countryCode: string | null | undefined, localNumber: string | null | undefined): string {
  const cc = (countryCode || "+91").replace(/\D/g, "");
  const digits = (localNumber || "").replace(/\D/g, "");
  if (!digits) return "";
  return cc === "91" ? digits : cc + digits;
}

// Picks WhatsApp number if the patient gave a separate one, else falls
// back to their mobile — this is the single place every send should go
// through so registration, reminders, follow-ups etc. all agree.
export function patientWhatsAppTarget(p: {
  mobile: string;
  mobile_country_code?: string | null;
  whatsapp_number?: string | null;
  whatsapp_country_code?: string | null;
}): string {
  if (p.whatsapp_number) {
    return buildWhatsAppDestination(p.whatsapp_country_code || p.mobile_country_code, p.whatsapp_number);
  }
  return buildWhatsAppDestination(p.mobile_country_code, p.mobile);
}

export async function createPatientWithVisit(input: {
  name: string;
  mobile: string;
  mobile_country_code?: string;
  whatsapp_country_code?: string;
  whatsapp_number?: string;
  age?: number;
  gender?: string;
  blood_group?: string;
  city?: string;
  address?: string;
  pincode?: string;
  primary_disease?: string;
  wa_consent: boolean;
  dob?: string;
  anniversary_date?: string;
  profession?: string;
  annual_income?: number;
  branch: "BAJAJ_NAGAR" | "JAGATPURA";
  chief_complaint?: string;
}) {
  // Both inserts (patient + visit) happen inside one Postgres function
  // call, which runs as a single transaction — if either insert fails,
  // Postgres rolls back everything automatically. No phantom-patient
  // window can occur, even momentarily, unlike doing the two inserts
  // separately from the client.
  const { data, error } = await supabase.rpc("register_patient_with_visit", {
    p_name: input.name,
    p_mobile: input.mobile,
    p_age: input.age ?? null,
    p_gender: input.gender ?? null,
    p_blood_group: input.blood_group ?? null,
    p_city: input.city ?? null,
    p_pincode: input.pincode ?? null,
    p_primary_disease: input.primary_disease ?? null,
    p_wa_consent: input.wa_consent,
    p_branch: input.branch,
    p_chief_complaint: input.chief_complaint ?? null,
    p_visit_date: today(),
  });
  if (!error && data) {
    let patient = data.patient as DBPatient;
    // The atomic RPC doesn't know about these newer columns yet (it's a
    // deployed Postgres function — changing it blind is riskier than one
    // small follow-up write). Only fires when there's actually something
    // non-default to save, so the common case with none of this filled
    // in does zero extra work.
    const hasExtra =
      (input.mobile_country_code && input.mobile_country_code !== "+91") ||
      input.whatsapp_number || input.dob || input.anniversary_date ||
      input.profession || input.annual_income != null || input.address;
    if (hasExtra) {
      const { data: updated } = await supabase
        .from("patients")
        .update({
          mobile_country_code: input.mobile_country_code || "+91",
          whatsapp_country_code: input.whatsapp_number ? input.whatsapp_country_code || null : null,
          whatsapp_number: input.whatsapp_number || null,
          address: input.address || null,
          dob: input.dob || null,
          anniversary_date: input.anniversary_date || null,
          profession: input.profession || null,
          annual_income: input.annual_income ?? null,
        })
        .eq("id", patient.id)
        .select("*")
        .maybeSingle();
      if (updated) patient = updated as DBPatient;
    }
    return { patient, visit: data.visit as DBVisit };
  }
  // Fall back to the old two-step approach if the RPC isn't deployed yet
  // (SQL migration not run) — registration must never hard-fail just
  // because a database migration is pending. Postgres error 42883 =
  // "function does not exist"; PostgREST surfaces this distinctly, so we
  // only silently fall back for that specific case and still throw for
  // any other (real) RPC error.
  const isMissingFunction = error?.code === "42883" || /function .* does not exist/i.test(error?.message ?? "");
  if (!isMissingFunction) throw error ?? new Error("Registration fail hui");
  return createPatientWithVisitLegacy(input);
}

async function createPatientWithVisitLegacy(input: {
  name: string;
  mobile: string;
  mobile_country_code?: string;
  whatsapp_country_code?: string;
  whatsapp_number?: string;
  age?: number;
  gender?: string;
  blood_group?: string;
  city?: string;
  address?: string;
  pincode?: string;
  primary_disease?: string;
  wa_consent: boolean;
  dob?: string;
  anniversary_date?: string;
  profession?: string;
  annual_income?: number;
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
      mobile_country_code: input.mobile_country_code || "+91",
      whatsapp_country_code: input.whatsapp_number ? input.whatsapp_country_code || null : null,
      whatsapp_number: input.whatsapp_number || null,
      dob: input.dob || null,
      anniversary_date: input.anniversary_date || null,
      profession: input.profession || null,
      annual_income: input.annual_income ?? null,
      age: input.age ?? null,
      gender: input.gender ?? null,
      blood_group: input.blood_group ?? null,
      city: input.city ?? null,
      pincode: input.pincode ?? null,
      address: input.address ?? null,
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
  if (ve || !v) {
    // Best-effort cleanup — this is the fallback path used only when the
    // atomic RPC isn't available yet.
    await supabase.from("patients").delete().eq("id", p.id);
    throw ve ?? new Error("Failed to create visit");
  }

  return { patient: p as DBPatient, visit: v as DBVisit };
}

export async function isDuplicateMobile(mobile: string, countryCode: string = "+91", excludePatientId?: string): Promise<boolean> {
  // India stays strict at exactly 10 digits (unchanged behavior). Other
  // countries vary in length, so we just require a plausible minimum
  // instead of guessing an exact digit count per country.
  const minLen = countryCode === "+91" ? 10 : 4;
  if (mobile.length < minLen) return false;
  // Same local number under a different country code is NOT a duplicate
  // (e.g. India +91 98765... vs UK +44 98765... are different people) —
  // scoping by both columns avoids false "already registered" warnings.
  let q = supabase
    .from("patients")
    .select("id", { count: "exact", head: true })
    .eq("mobile", mobile)
    .eq("mobile_country_code", countryCode);
  if (excludePatientId) q = q.neq("id", excludePatientId);
  const { count } = await q;
  return (count ?? 0) > 0;
}

// Everything a patient might need corrected after registration — mobile,
// WhatsApp number, address, and the "collect once" fields in case they
// were skipped at intake. Only the fields actually passed get touched.
export async function updatePatientContactInfo(
  patientId: string,
  fields: Partial<{
    mobile: string;
    mobile_country_code: string;
    whatsapp_country_code: string | null;
    whatsapp_number: string | null;
    address: string;
    city: string;
    pincode: string;
    dob: string | null;
    anniversary_date: string | null;
    profession: string | null;
    annual_income: number | null;
  }>,
): Promise<{ success: boolean; error: string | null; patient: DBPatient | null }> {
  const { data, error } = await supabase
    .from("patients")
    .update(fields)
    .eq("id", patientId)
    .select("*")
    .maybeSingle();
  return { success: !error, error: error?.message ?? null, patient: (data as DBPatient) ?? null };
}

// ---------- Queue reads ----------
// IMPORTANT: this used to filter strictly on visit_date = today, which meant
// any visit not resolved the same day it was registered (e.g. an online
// case taken today with the doctor's actual consult scheduled days later)
// would silently disappear from every queue forever once the date rolled
// over — nobody would ever see it again unless they manually searched for
// the patient by name. Now: still-open visits (anything not DONE) show up
// regardless of which day they were registered, so nothing gets lost.
// Only DONE visits are date-scoped, so "today's completed count" still
// means today, not all-time.
//
// A 30-day floor is applied to the "still open" side too — a visit that's
// been stuck for over a month is already broken data (something else went
// wrong), not a realistic "carried-over case". Without this floor the
// query and the queue itself would grow without bound over the life of
// the clinic. 30 days comfortably covers the real scenario this fix was
// built for (a case taken today, doctor visit days later).
export function thirtyDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

export async function fetchTodayQueue(branch?: string) {
  let q = supabase
    .from("visits")
    .select("*, patient:patients(*)")
    .or(`visit_date.eq.${today()},and(visit_status.neq.DONE,visit_date.gte.${thirtyDaysAgo()})`)
    .order("created_at", { ascending: true });
  if (branch) q = q.eq("branch", branch);
  const { data, error } = await q;
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

// ---------- Case-DR eligibility (Junior sees Simple only, Senior sees all) ----------
export async function fetchCaseDrLevels(): Promise<Record<string, "Junior" | "Senior">> {
  const { data } = await supabase.from("settings").select("value").eq("key", "case_dr_levels").maybeSingle();
  if (!data?.value) return {};
  try {
    return JSON.parse(data.value);
  } catch {
    return {};
  }
}

export async function saveCaseDrLevels(levels: Record<string, "Junior" | "Senior">) {
  await upsertSetting("case_dr_levels", JSON.stringify(levels));
}

const CASE_DR_SAFE_PATIENT_FIELDS = "id, name, age, gender, primary_disease, card_number, card_register";

// Same fix as fetchTodayQueue (including the 30-day floor) — an unfinished
// case-taking (e.g. a Junior Case-DR's draft) must not vanish from the
// board just because a day passed, but shouldn't accumulate forever either.
export async function fetchTodayQueueCaseDR(branch?: string) {
  let q = supabase
    .from("visits")
    .select(`*, patient:patients(${CASE_DR_SAFE_PATIENT_FIELDS})`)
    .or(`visit_date.eq.${today()},and(visit_status.neq.DONE,visit_date.gte.${thirtyDaysAgo()})`)
    .order("created_at", { ascending: true });
  if (branch) q = q.eq("branch", branch);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as (DBVisit & { patient: Partial<DBPatient> })[];
}


export async function updateCaseComplexity(visitId: string, complexity: "Simple" | "Complex") {
  const { error } = await supabase.from("visits").update({ case_complexity: complexity }).eq("id", visitId);
  return { success: !error, error: error?.message ?? null };
}

export async function fetchVisitForCaseDR(visitId: string) {
  const { data, error } = await supabase
    .from("visits")
    .select(`*, patient:patients(${CASE_DR_SAFE_PATIENT_FIELDS})`)
    .eq("id", visitId)
    .maybeSingle();
  if (error) throw error;
  return data as (DBVisit & { patient: Partial<DBPatient> }) | null;
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
  // Payment insert + patient-totals recompute + visit-status update all
  // happen inside ONE Postgres function (collect_payment_atomic), which
  // runs as a single transaction with row-level locks on the visit and
  // patient rows. If any step fails, Postgres rolls back everything —
  // no window where money is recorded but the visit/patient are stale,
  // and no race where two simultaneous payments for the same patient
  // clobber each other's totals. current_balance is always recomputed
  // as SUM(payments.balance_due) for the patient, not overwritten from
  // just this visit, so older outstanding dues are never wiped.
  const { data, error } = await supabase.rpc("collect_payment_atomic", {
    p_visit_id: input.visit_id,
    p_patient_id: input.patient_id,
    p_amount_charged: input.amount_charged,
    p_amount_received: input.amount_received,
    p_payment_mode: input.payment_mode,
    p_branch: input.branch,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;

  // Follow-up scheduling is a downstream side effect, not money — it
  // stays as a separate best-effort call so a follow-up-table hiccup
  // never rolls back a payment that was already accepted from the
  // patient. It's still surfaced (not silently swallowed) so staff know
  // to check the follow-up queue manually if it fails.
  if (data?.balance === 0) {
    try {
      await generateFollowupSchedule(input.patient_id, input.visit_id, data?.next_visit_date ?? null);
    } catch (e: any) {
      throw new Error(
        "Payment collect ho gaya aur visit DONE mark ho gayi, lekin follow-up schedule create nahi ho paya — follow-up queue manually check karo: " +
          (e?.message || "unknown error"),
      );
    }
  }
}

// ---------- Prescriptions ----------
export async function fetchInventorySearch(term: string) {
  const clean = sanitizeIlikeTerm(term);
  const q = supabase.from("inventory").select("*").limit(20);
  const { data, error } = clean
    ? await q.ilike("medicine_name", `%${clean}%`)
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
  const { error: ve } = await supabase
    .from("visits")
    .update({
      visit_status: "PHARMACY",
      doctor_notes: input.doctor_notes,
      next_visit_date: input.next_visit_date,
    })
    .eq("id", input.visit_id);
  if (ve) throw ve;
  const { error: pe } = await supabase
    .from("patients")
    .update({ last_visit_date: today() })
    .eq("id", input.patient_id);
  if (pe) throw pe;
}

// ---------- Holiday greetings (owner-configurable) ----------
// Festival dates change every year (Diwali, Holi, Eid...), so this is a
// plain list the owner adds specific dates to — no recurrence logic to
// get wrong. whatsapp-holiday-greetings Edge Function (Cron, daily)
// checks today against this list and broadcasts to every consented
// patient. Needs an approved AiSensy campaign named "HOLIDAY_GREETING".
export interface Holiday {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD, specific to this year
  active: boolean;
}

export async function fetchHolidays(): Promise<Holiday[]> {
  const { data, error } = await supabase.from("holidays").select("*").order("date", { ascending: true });
  if (error) return [];
  return (data ?? []) as Holiday[];
}

export async function saveHoliday(input: Partial<Holiday> & { name: string; date: string }) {
  const { id, ...rest } = input;
  const { error } = id
    ? await supabase.from("holidays").update(rest).eq("id", id)
    : await supabase.from("holidays").insert(rest);
  return { success: !error, error: error?.message ?? null };
}

export async function deleteHoliday(id: string) {
  const { error } = await supabase.from("holidays").delete().eq("id", id);
  return { success: !error, error: error?.message ?? null };
}

// ---------- Win-back tiers (owner-configurable) ----------
// Lapsed patients get a staged nudge (60/90/120/150+ days by default) —
// not one message then silence. Owner edits tiers from the app; the
// whatsapp-winback Edge Function (Cron, daily) reads this table and does
// the sending. Needs an approved AiSensy campaign named "WINBACK".
export interface WinbackTier {
  id: string;
  label: string;
  days_lapsed: number;
  active: boolean;
}

export async function fetchWinbackTiers(): Promise<WinbackTier[]> {
  const { data, error } = await supabase.from("winback_tiers").select("*").order("days_lapsed", { ascending: true });
  if (error) return [];
  return (data ?? []) as WinbackTier[];
}

export async function saveWinbackTier(input: Partial<WinbackTier> & { label: string; days_lapsed: number }) {
  const { id, ...rest } = input;
  const { error } = id
    ? await supabase.from("winback_tiers").update(rest).eq("id", id)
    : await supabase.from("winback_tiers").insert(rest);
  return { success: !error, error: error?.message ?? null };
}

export async function deleteWinbackTier(id: string) {
  const { error } = await supabase.from("winback_tiers").delete().eq("id", id);
  return { success: !error, error: error?.message ?? null };
}

// ---------- Follow-up sequence engine (owner-configurable) ----------
// Owner edits `followup_touchpoints` from the app (Owner → Follow-up
// Rules) — add/remove/change touchpoints any time, no code changes ever
// needed again. Longer treatment gaps get more check-ins spread across
// the wait; short gaps get just the close-in reminders.
export interface FollowupTouchpoint {
  id: string;
  label: string;
  min_gap_days: number;
  max_gap_days: number;
  days_before_due: number;
  active: boolean;
}

export async function fetchFollowupTouchpoints(): Promise<FollowupTouchpoint[]> {
  const { data, error } = await supabase
    .from("followup_touchpoints")
    .select("*")
    .order("min_gap_days", { ascending: true })
    .order("days_before_due", { ascending: false });
  if (error) return [];
  return (data ?? []) as FollowupTouchpoint[];
}

export async function saveFollowupTouchpoint(input: Partial<FollowupTouchpoint> & { label: string; min_gap_days: number; max_gap_days: number; days_before_due: number }) {
  const { id, ...rest } = input;
  const { error } = id
    ? await supabase.from("followup_touchpoints").update(rest).eq("id", id)
    : await supabase.from("followup_touchpoints").insert(rest);
  return { success: !error, error: error?.message ?? null };
}

export async function deleteFollowupTouchpoint(id: string) {
  const { error } = await supabase.from("followup_touchpoints").delete().eq("id", id);
  return { success: !error, error: error?.message ?? null };
}

// Generates every reminder row for one visit's next-visit date, based on
// whichever bracket its gap falls into. Falls back to a single 7-day
// reminder if no rule matches or next_visit_date wasn't set — a patient
// must never end up with zero follow-up just because the rules table is
// empty or mid-edit.
export async function generateFollowupSchedule(patientId: string, visitId: string, nextVisitDate: string | null): Promise<void> {
  const todayD = new Date(today());
  let dueTarget = nextVisitDate ? new Date(nextVisitDate) : null;
  if (!dueTarget || isNaN(dueTarget.getTime())) {
    dueTarget = new Date(todayD);
    dueTarget.setDate(dueTarget.getDate() + 30);
  }
  const gapDays = Math.max(0, Math.round((dueTarget.getTime() - todayD.getTime()) / 86_400_000));

  const rules = await fetchFollowupTouchpoints();
  const matched = rules.filter((r) => r.active && gapDays >= r.min_gap_days && gapDays <= r.max_gap_days);

  const rows =
    matched.length > 0
      ? matched.map((r) => {
          const d = new Date(dueTarget!);
          d.setDate(d.getDate() - r.days_before_due);
          if (d < todayD) d.setTime(todayD.getTime()); // never schedule a reminder in the past
          return {
            patient_id: patientId,
            visit_id: visitId,
            due_date: d.toISOString().slice(0, 10),
            followup_type: r.label,
            status: "PENDING" as const,
          };
        })
      : [
          {
            patient_id: patientId,
            visit_id: visitId,
            due_date: dueTarget.toISOString().slice(0, 10),
            followup_type: "DEFAULT",
            status: "PENDING" as const,
          },
        ];

  const { error } = await supabase.from("followups").insert(rows);
  if (error) {
    // Must not silently lose follow-up coverage — surface it so the
    // caller (payment flow) can at least log/alert rather than pretend
    // this patient has a working reminder when they don't.
    console.error("generateFollowupSchedule insert failed:", error.message);
  }
}

// ---------- Follow-ups ----------
export async function fetchFollowups() {
  // Was previously .lte("due_date", today()) — overdue + due-today only.
  // That made the UI's "Due Soon" stat and "N din baaki" (days remaining)
  // display permanently unreachable, since nothing with a future due_date
  // was ever fetched. Now includes the next 7 days too, so upcoming
  // follow-ups are visible ahead of time instead of only on/after the day
  // they're due.
  const upper = new Date();
  upper.setDate(upper.getDate() + 7);
  const upperStr = upper.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("followups")
    .select("*, patient:patients(*)")
    .eq("status", "PENDING")
    .lte("due_date", upperStr)
    .order("due_date", { ascending: true })
    .limit(200);
  if (error) return [];
  return data ?? [];
}

export async function markFollowupDone(id: string) {
  const { error } = await supabase.from("followups").update({ status: "DONE" }).eq("id", id);
  if (error) throw error;
}

// ---------- Leads ----------
// ---------- Call + WhatsApp interaction timeline ----------
// Shared by Lead CRM and Follow-up CRM. Whoever picks up the phone next —
// even after staff turnover — can see exactly when messages went out and
// what was discussed on the last call, instead of starting from zero.
export interface Interaction {
  id: string;
  lead_id: string | null;
  patient_id: string | null;
  type: "call" | "whatsapp";
  summary: string;
  created_by: string | null;
  created_at: string;
}

export async function fetchInteractions(target: { leadId?: string; patientId?: string }): Promise<Interaction[]> {
  let q = supabase.from("interactions").select("*").order("created_at", { ascending: false }).limit(50);
  if (target.leadId) q = q.eq("lead_id", target.leadId);
  if (target.patientId) q = q.eq("patient_id", target.patientId);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as Interaction[];
}

export async function logCallInteraction(input: {
  leadId?: string;
  patientId?: string;
  summary: string;
  createdBy?: string;
}): Promise<{ success: boolean; error: string | null }> {
  if (!input.summary.trim()) return { success: false, error: "Summary required" };
  const { error } = await supabase.from("interactions").insert({
    lead_id: input.leadId ?? null,
    patient_id: input.patientId ?? null,
    type: "call",
    summary: input.summary.trim(),
    created_by: input.createdBy ?? null,
  });
  return { success: !error, error: error?.message ?? null };
}

// Fire-and-forget — a logging hiccup must never block the WhatsApp send
// itself, which has already gone out by the time this is called.
export async function logWhatsAppInteraction(
  target: { leadId?: string; patientId?: string },
  summary: string,
): Promise<void> {
  try {
    await supabase.from("interactions").insert({
      lead_id: target.leadId ?? null,
      patient_id: target.patientId ?? null,
      type: "whatsapp",
      summary,
    });
  } catch {
    // non-fatal
  }
}

export type LeadStatus = "HOT" | "Warm" | "Cold" | "Converted" | "Lost";

// Once leads volume is large (thousands+), the plain list (capped at 500,
// most-recent-first) can't be how anyone finds an older lead — this is
// the server-side search that makes that possible regardless of table size.
export async function searchLeads(term: string) {
  const t = sanitizeOrFilterTerm(term);
  if (!t) return [];
  const like = `%${t}%`;
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .or(`name.ilike.${like},mobile.ilike.${like},source.ilike.${like}`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return data ?? [];
}

// Real counts via COUNT queries — independent of fetchLeads()'s 500-row
// display cap, so these numbers stay accurate no matter how large the
// leads table gets (30k+ imported leads would otherwise make the
// client-side-computed stats wildly wrong, since they'd only reflect
// whichever 500 rows happened to load).
export async function fetchLeadStats() {
  const [total, hot, converted, newToday] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true }),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "HOT"),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "Converted"),
    supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", istDayStart(today())),
  ]);
  return {
    total: total.count ?? 0,
    hot: hot.count ?? 0,
    converted: converted.count ?? 0,
    newToday: newToday.count ?? 0,
  };
}

export async function fetchLeads() {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return [];
  return data ?? [];
}
export async function updateLeadStatus(id: string, status: LeadStatus) {
  const { error } = await supabase.from("leads").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function setLeadDnd(id: string, dnd: boolean) {
  const { error } = await supabase.from("leads").update({ dnd }).eq("id", id);
  return { success: !error, error: error?.message ?? null };
}

// ---------- Inventory ----------
export async function fetchInventory() {
  const { data, error } = await supabase
    .from("inventory")
    .select("*")
    .order("medicine_name", { ascending: true })
    .limit(2000);
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
    .order("medicine_name", { ascending: true })
    .limit(2000);
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
  const { error } = await supabase.from("visits").update({ visit_status: "PAYMENT" }).eq("id", visitId);
  if (error) throw error;
}

// ---------- Case notes ----------

// Case-paper/tongue/reports photos come straight off a phone camera and can
// be 3-8 MB each. Uploading that raw over clinic wifi/mobile data is what was
// showing up as the case-taking page "hanging" — the spinner never resolves
// because the upload itself is crawling. We shrink to a sane max dimension
// and re-encode as JPEG client-side first, which typically takes a multi-MB
// photo down to 150-400 KB with no visible quality loss for reading a case
// paper. If compression fails for any reason we safely fall back to the
// original file rather than blocking the upload.
//
// `documentMode` additionally boosts contrast/brightness so a handwritten
// case paper or lab report photo reads like a flat scan instead of a dim,
// shadowy phone photo — this is deliberately NOT applied to tongue photos,
// where true color is clinically meaningful (coating/color assessment).
export function looksLikeHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return type.includes("heic") || type.includes("heif") || name.endsWith(".heic") || name.endsWith(".heif");
}

async function toBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch (err) {
    // createImageBitmap fails on HEIC/HEIF (default iPhone camera format)
    // in most non-Safari browsers. Convert to JPEG first — only pulls in
    // the ~1.3MB decoder when an actual HEIC file shows up (dynamic
    // import keeps it out of the main app bundle entirely otherwise).
    if (!looksLikeHeic(file)) throw err;
    const heic2any = (await import("heic2any")).default;
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
    const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
    return createImageBitmap(jpegBlob as Blob);
  }
}

async function compressImageForUpload(
  file: File,
  opts: { maxDim?: number; quality?: number; documentMode?: boolean } = {},
): Promise<File> {
  const { maxDim = 1600, quality = 0.72, documentMode = false } = opts;
  if (typeof window === "undefined" || (!file.type.startsWith("image/") && !looksLikeHeic(file))) return file;
  try {
    const bitmap = await toBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    if (documentMode && "filter" in ctx) {
      // Flattens uneven lighting/shadows and lifts ink contrast — the same
      // idea document-scanner apps use, without full edge-detection/crop.
      (ctx as any).filter = "contrast(1.35) brightness(1.12) saturate(0.85)";
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return file;
    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch {
    return file; // compression (and HEIC conversion) failed — upload the original rather than fail the whole flow
  }
}

// Clinic wifi can stall completely rather than error out. Without a hard
// timeout, "Uploading…" (and the whole submit flow behind it) can sit frozen
// indefinitely. This forces a clear failure the user can retry instead.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out — check your connection and try again`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// ---------- Signed URL resolver (buckets are private) ----------
// case_photo_url / tongue_photo_url / reports_photo_url / patient_documents.photo_url
// all still store the old "https://.../object/public/<bucket>/<path>" shape.
// Buckets are private now, so that stored value only works as an identifier —
// the path suffix after `/${bucket}/` — from which we mint a short-lived
// signed URL each time the document actually needs to be shown. Nothing is
// ever written back to the DB from this function; it's read-only resolution.
export async function resolveDocUrl(
  bucket: "patient-documents" | "case-photos",
  stored: string | null | undefined,
  expiresIn = 3600,
): Promise<string | null> {
  if (!stored) return null;
  const marker = `/${bucket}/`;
  const idx = stored.indexOf(marker);
  const path = idx >= 0 ? stored.slice(idx + marker.length) : stored;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function uploadCasePhoto(visitId: string, kind: "case" | "tongue" | "reports", file: File) {
  try {
    const compressed = await compressImageForUpload(file, { documentMode: kind !== "tongue" });
    const ext = compressed.name.split(".").pop() || "jpg";
    const path = `${visitId}/${kind}-${Date.now()}.${ext}`;
    const { error } = await withTimeout(
      supabase.storage.from("case-photos").upload(path, compressed, { upsert: true }),
      25_000,
      "Photo upload",
    );
    if (error) return { success: false, error: error.message, url: null };
    const { data } = supabase.storage.from("case-photos").getPublicUrl(path);
    return { success: true, error: null, url: data.publicUrl };
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Upload failed", url: null };
  }
}

export interface CaseNotesInput {
  notes: string;
  draft?: boolean; // true = keep in CASE_TAKING status (not submitted yet)
  case_photo_url?: string | null;
  tongue_photo_url?: string | null;
  reports_photo_url?: string | null;
}

// ---------- Physical case-register card number ----------
// Each doctor keeps their own physical case register and hands out
// numbers from it — so the same number can legitimately exist under two
// different doctors' registers, but a duplicate WITHIN the same register
// almost always means a data-entry mistake (this was the exact "same
// number given 2-3 times, then a/b/c suffixes, then the whole sequence
// has to be redone" problem). Scoping the check to (number + register)
// catches the real duplicates without false-flagging different doctors.
export async function isDuplicateCardNumber(
  cardNumber: string,
  cardRegister: string,
  excludePatientId?: string,
): Promise<boolean> {
  const num = cardNumber.trim();
  const reg = cardRegister.trim();
  if (!num || !reg) return false;
  let q = supabase
    .from("patients")
    .select("id", { count: "exact", head: true })
    .eq("card_number", num)
    .eq("card_register", reg);
  if (excludePatientId) q = q.neq("id", excludePatientId);
  const { count } = await q;
  return (count ?? 0) > 0;
}

export async function savePatientCardNumber(patientId: string, cardNumber: string, cardRegister: string) {
  const { error } = await supabase
    .from("patients")
    .update({ card_number: cardNumber.trim() || null, card_register: cardRegister.trim() || null })
    .eq("id", patientId);
  return { success: !error, error: error?.message ?? null };
}

export async function saveCaseNotes(visitId: string, input: string | CaseNotesInput) {
  const payload: Record<string, any> =
    typeof input === "string" ? { doctor_notes: input } : { doctor_notes: input.notes };
  if (typeof input !== "string") {
    if (input.case_photo_url !== undefined) payload.case_photo_url = input.case_photo_url;
    if (input.tongue_photo_url !== undefined) payload.tongue_photo_url = input.tongue_photo_url;
    if (input.reports_photo_url !== undefined) payload.reports_photo_url = input.reports_photo_url;
  }
  const isDraft = typeof input !== "string" && input.draft;
  if (!isDraft) payload.visit_status = "WAITING_DOCTOR";
  const { error } = await supabase.from("visits").update(payload).eq("id", visitId);
  if (error) throw error; // caller (submit/saveDraft) shows this — was silently "succeeding" before
}

// ---------- Doctor dashboard ----------
// Clinic-wide numbers (visits don't carry a doctor_id column, so per-doctor
// scoping isn't possible here — reporting the whole clinic is accurate,
// not fabricated). Top-complaint bucketing is a plain frequency count over
// this month's chief_complaint strings; nothing is normalized/synonyms-merged.
export async function fetchDoctorDashboard() {
  const t = today();
  const monthStart = t.slice(0, 8) + "01";

  const [
    todaySeen,
    todayNew,
    todayFollowupsDone,
    monthPatientsVisits,
    monthPay,
    monthComplaints,
    awaitingRx,
  ] = await Promise.all([
    supabase.from("visits").select("id", { count: "exact", head: true }).eq("visit_date", t).eq("visit_status", "DONE"),
    supabase.from("patients").select("id", { count: "exact", head: true }).gte("created_at", istDayStart(t)),
    supabase.from("followups").select("id", { count: "exact", head: true }).eq("status", "DONE").gte("updated_at", istDayStart(t)),
    supabase.from("visits").select("patient_id").gte("visit_date", monthStart),
    supabase.from("payments").select("amount_received").gte("created_at", istDayStart(monthStart)),
    supabase.from("visits").select("chief_complaint").gte("visit_date", monthStart).not("chief_complaint", "is", null),
    supabase.from("visits").select("id", { count: "exact", head: true })
      .in("visit_status", ["WAITING_DOCTOR", "CASE_TAKING", "REGISTERED"])
      .gte("visit_date", thirtyDaysAgo()),
  ]);

  const monthPatients = new Set((monthPatientsVisits.data ?? []).map((v: any) => v.patient_id)).size;
  const monthRevenue = (monthPay.data ?? []).reduce((s: number, r: any) => s + Number(r.amount_received ?? 0), 0);

  const bucket = new Map<string, number>();
  for (const r of (monthComplaints.data ?? []) as any[]) {
    const raw = String(r.chief_complaint ?? "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }
  const topComplaints = Array.from(bucket.entries())
    .map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return {
    todaySeen: todaySeen.count ?? 0,
    todayNew: todayNew.count ?? 0,
    todayFollowupsDone: todayFollowupsDone.count ?? 0,
    monthPatients,
    monthRevenue,
    topComplaints,
    awaitingRx: awaitingRx.count ?? 0,
  };
}

// ---------- Owner ----------

export async function fetchOwnerStats() {
  const t = today();
  const monthStart = t.slice(0, 8) + "01";
  const [todayVisitsBajaj, todayVisitsJagatpura, todayPay, monthPay, newToday, followupsToday] =
    await Promise.all([
      supabase.from("visits").select("id", { count: "exact", head: true }).eq("visit_date", t).eq("branch", "BAJAJ_NAGAR"),
      supabase.from("visits").select("id", { count: "exact", head: true }).eq("visit_date", t).eq("branch", "JAGATPURA"),
      supabase.from("payments").select("amount_received,payment_mode,branch").gte("created_at", istDayStart(t)),
      supabase.from("payments").select("amount_received,payment_mode,branch").gte("created_at", istDayStart(monthStart)),
      supabase.from("patients").select("id", { count: "exact", head: true }).gte("created_at", istDayStart(t)),
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
    monthOther: sum(monthPay.data, (r) => !["CASH", "UPI", "CARD"].includes(r.payment_mode)),
    newToday: newToday.count ?? 0,
    followupsToday: followupsToday.count ?? 0,
  };
}

// IST is UTC+5:30. Comparing a timestamptz column (created_at) against a
// plain "YYYY-MM-DD" string makes Postgres treat it as UTC midnight —
// about 5.5 hours off from actual IST midnight. In practice this only
// bites during roughly 12:00am-5:30am IST (a payment/registration then
// would land in "yesterday" instead of "today" in day/week/month
// totals) — outside clinic hours, but real if anyone logs something late
// or a clock is off. These explicit-offset literals make Postgres compare
// correctly regardless of the exact time of day.
function istDayStart(dateStr: string): string {
  return `${dateStr}T00:00:00+05:30`;
}
function istDayEnd(dateStr: string): string {
  return `${dateStr}T23:59:59.999+05:30`;
}
// For client-side re-bucketing of already-fetched rows by IST calendar
// day (used where we can't push the boundary into the SQL query itself).
function istDateOf(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return "";
  return new Date(new Date(isoTimestamp).getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
    .gte("created_at", istDayStart(start));
  return days.map((day) => {
    const total = (data ?? [])
      .filter((r: any) => istDateOf(r.created_at) === day.d)
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
  let payQ = supabase.from("payments").select("amount_received,amount_charged,balance_due,payment_mode").gte("created_at", istDayStart(start));
  let visQ = supabase.from("visits").select("id,patient_id").gte("visit_date", start);
  let patQ = supabase.from("patients").select("id", { count: "exact", head: true }).gte("created_at", istDayStart(start));
  let leadQ = supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "Converted").gte("created_at", istDayStart(start));
  if (branch) {
    payQ = payQ.eq("branch", branch);
    visQ = visQ.eq("branch", branch);
    patQ = patQ.eq("branch", branch);
  }
  if (end) {
    payQ = payQ.lte("created_at", istDayEnd(end));
    visQ = visQ.lte("visit_date", end);
    patQ = patQ.lte("created_at", istDayEnd(end));
    leadQ = leadQ.lte("created_at", istDayEnd(end));
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

// ---------- Appointments ----------
export interface NewAppointmentInput {
  patient_name: string;
  mobile?: string;
  appointment_date: string; // YYYY-MM-DD
  appointment_time?: string;
  slot_minutes?: number;
  doctor?: string;
  reason?: string;
  branch?: string;
  patient_id?: string;
}

export async function fetchAppointments(date?: string) {
  let q = supabase.from("appointments").select("*").order("appointment_time", { ascending: true });
  if (date) q = q.eq("appointment_date", date);
  const { data, error } = await q;
  if (error) return [];
  return data ?? [];
}

export async function createAppointment(input: NewAppointmentInput) {
  const { data, error } = await supabase
    .from("appointments")
    .insert({ ...input, status: "Confirmed" })
    .select()
    .single();
  if (error) return { success: false, error: error.message, data: null };
  return { success: true, error: null, data };
}

export async function updateAppointmentStatus(id: string, status: string) {
  const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
  return { success: !error, error: error?.message ?? null };
}

// ---------- Appointment slot config + VIP reserved slots ----------
// Deliberately built on the existing `settings` key-value table (already
// used for backup-doctor config, reception permissions, Case-DR levels) —
// no new table/column needed, so this needs no SQL step to turn on.

export type ApptBranch = "BAJAJ_NAGAR" | "JAGATPURA";

export interface SlotConfig {
  slotMinutes: number;
  capacityPerSlot: number;
  hours: Record<ApptBranch, { start: string; end: string }>;
}

export const DEFAULT_SLOT_CONFIG: SlotConfig = {
  slotMinutes: 15,
  capacityPerSlot: 2,
  hours: {
    "BAJAJ_NAGAR": { start: "09:00", end: "20:00" },
    "JAGATPURA": { start: "09:00", end: "20:00" },
  },
};

export async function fetchSlotConfig(): Promise<SlotConfig> {
  const { data } = await supabase.from("settings").select("value").eq("key", "appointment_slot_config").maybeSingle();
  if (!data?.value) return DEFAULT_SLOT_CONFIG;
  try {
    const parsed = JSON.parse(data.value);
    return {
      slotMinutes: parsed.slotMinutes ?? DEFAULT_SLOT_CONFIG.slotMinutes,
      capacityPerSlot: parsed.capacityPerSlot ?? DEFAULT_SLOT_CONFIG.capacityPerSlot,
      hours: { ...DEFAULT_SLOT_CONFIG.hours, ...(parsed.hours ?? {}) },
    };
  } catch {
    return DEFAULT_SLOT_CONFIG;
  }
}

export async function saveSlotConfig(cfg: SlotConfig) {
  await upsertSetting("appointment_slot_config", JSON.stringify(cfg));
}

// Generates "HH:MM" strings from start (inclusive) to end (exclusive) at the given interval.
export function generateSlots(start: string, end: string, minutes: number): string[] {
  const slots: string[] = [];
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let h = sh, m = sm;
  let guard = 0; // safety valve against a bad config (e.g. end before start) looping forever
  while ((h < eh || (h === eh && m < em)) && guard < 500) {
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    m += minutes;
    while (m >= 60) { m -= 60; h += 1; }
    guard++;
  }
  return slots;
}

export interface VipSlot { id: string; branch: ApptBranch; date: string; time: string; note?: string }

export async function fetchVipSlots(): Promise<VipSlot[]> {
  const { data } = await supabase.from("settings").select("value").eq("key", "vip_reserved_slots").maybeSingle();
  try { return data?.value ? JSON.parse(data.value) : []; } catch { return []; }
}

export async function addVipSlot(slot: Omit<VipSlot, "id">) {
  const list = await fetchVipSlots();
  const withId: VipSlot = { ...slot, id: `VIP_${Date.now()}` };
  list.push(withId);
  await upsertSetting("vip_reserved_slots", JSON.stringify(list));
  return withId;
}

export async function removeVipSlot(id: string) {
  const list = await fetchVipSlots();
  await upsertSetting("vip_reserved_slots", JSON.stringify(list.filter((s) => s.id !== id)));
}

export interface SlotInfo { time: string; booked: number; capacity: number; vip: boolean; vipNote?: string; full: boolean }

// Combines slot config + today's actual bookings + any VIP holds for this
// exact date/branch into one list the New Appointment picker can render directly.
export async function fetchSlotAvailability(date: string, branch: ApptBranch): Promise<SlotInfo[]> {
  const [cfg, vip, appts] = await Promise.all([
    fetchSlotConfig(),
    fetchVipSlots(),
    fetchAppointments(date),
  ]);
  const hours = cfg.hours[branch] ?? DEFAULT_SLOT_CONFIG.hours[branch];
  const times = generateSlots(hours.start, hours.end, cfg.slotMinutes);
  const activeAppts = (appts as any[]).filter((a) => a.branch === branch && a.status !== "Cancelled");
  const vipForThis = vip.filter((v) => v.date === date && v.branch === branch);
  return times.map((t) => {
    const booked = activeAppts.filter((a) => (a.appointment_time ?? "").slice(0, 5) === t).length;
    const vipMatch = vipForThis.find((v) => v.time === t);
    return {
      time: t,
      booked,
      capacity: cfg.capacityPerSlot,
      vip: !!vipMatch,
      vipNote: vipMatch?.note,
      full: booked >= cfg.capacityPerSlot,
    };
  });
}

// ---------- Deliveries ----------
export const DELIVERY_STEPS = ["Packed", "Dispatched", "Out for Delivery", "Delivered"] as const;

export interface NewDeliveryInput {
  patient_id?: string;
  visit_id?: string;
  patient_name?: string;
  token?: string;
  area?: string;
  partner: string;
  address?: string;
  advance_amount_paid: number;
  branch?: string;
}

export async function fetchDeliveries() {
  const { data, error } = await supabase
    .from("deliveries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return [];
  return data ?? [];
}

export async function createDelivery(input: NewDeliveryInput) {
  if (!input.advance_amount_paid || input.advance_amount_paid <= 0) {
    return { success: false, error: "Advance payment is required before creating a delivery", data: null };
  }
  const { data, error } = await supabase
    .from("deliveries")
    .insert({ ...input, status: "Packed" })
    .select()
    .single();
  if (error) return { success: false, error: error.message, data: null };
  return { success: true, error: null, data };
}

export async function updateDelivery(id: string, patch: { status?: string; note?: string }) {
  const { error } = await supabase.from("deliveries").update(patch).eq("id", id);
  return { success: !error, error: error?.message ?? null };
}

export async function updateDeliveryStatus(id: string, status: string) {
  return updateDelivery(id, { status });
}

export async function fetchStockIssues(limit = 10) {
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .eq("action", "STOCK_ISSUE")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return data ?? [];
}

export async function reportStockIssue(visitId: string, note: string) {
  const { error } = await supabase.from("audit_log").insert({
    action: "STOCK_ISSUE",
    table_name: "visits",
    record_id: visitId,
    new_value: note,
  });
  return { success: !error, error: error?.message ?? null };
}

export async function fetchOutstandingPatients() {
  const { data, error } = await supabase
    .from("patients")
    .select("id, name, mobile, patient_code, current_balance, last_visit_date, branch")
    .gt("current_balance", 0)
    .order("current_balance", { ascending: false })
    .limit(500);
  if (error) return [];
  return data ?? [];
}

export async function fetchStaff() {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("role", { ascending: true })
    .limit(200);
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

// Visits older than the 30-day queue floor that are still not DONE are
// exactly the ones that stopped showing up in every staff queue (see
// fetchTodayQueue/fetchTodayQueueCaseDR). Hiding genuinely stuck/forgotten
// cases from EVERYONE isn't the goal — this gives the Owner a way to see
// them, since staff queues intentionally no longer will.
export async function fetchStaleOpenVisits() {
  const { data, error } = await supabase
    .from("visits")
    .select("id,visit_date,visit_status,token_number,branch,patient:patients(name,mobile,patient_code)")
    .neq("visit_status", "DONE")
    .lt("visit_date", thirtyDaysAgo())
    .order("visit_date", { ascending: true })
    .limit(200);
  if (error) return [];
  return data ?? [];
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
  const { error } = data?.id
    ? await supabase.from("settings").update({ value }).eq("id", data.id)
    : await supabase.from("settings").insert({ key, value });
  if (error) throw error;
}

// ---------- Bulk Import (Leads / Patients / Visit-Revenue History) ----------
// Design principles (matching the safety rules this project runs on):
//  - Dry-run preview ALWAYS before writing anything (valid/duplicate/invalid counts)
//  - Every inserted row tagged with an imported_batch ID so a bad import can
//    be undone in one tap without touching anything that was already there
//  - Dedup by normalized mobile number throughout
//  - Batched writes (200 rows/request) so large files don't time out

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function normalizeMobile(raw: string | number | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Comma/parens break PostgREST's .or() filter syntax outright. % and _
// are ILIKE wildcards — a literal one in the search box (e.g. "50%" or
// "type_A") would silently widen the match instead of erroring, giving
// confusingly broad results rather than the expected ones.
export function sanitizeOrFilterTerm(term: string): string {
  return term.trim().replace(/[,()%_\\]/g, " ").replace(/\s+/g, " ").trim();
}

// Lighter version for a single .ilike() call (no .or(), so comma/parens
// aren't structurally dangerous there — only the wildcard chars are).
export function sanitizeIlikeTerm(term: string): string {
  return term.replace(/[%_\\]/g, " ").trim();
}

export function newImportBatchId(): string {
  return `IMPORT_${Date.now()}`;
}

export async function recordImportBatch(entry: { batchId: string; type: string; count: number }) {
  const { data } = await supabase.from("settings").select("value").eq("key", "import_batches").maybeSingle();
  let list: any[] = [];
  try { list = data?.value ? JSON.parse(data.value) : []; } catch { list = []; }
  list.unshift({ ...entry, date: new Date().toISOString() });
  await upsertSetting("import_batches", JSON.stringify(list.slice(0, 30)));
}

export async function fetchImportBatches(): Promise<
  { batchId: string; type: string; count: number; date: string }[]
> {
  const { data } = await supabase.from("settings").select("value").eq("key", "import_batches").maybeSingle();
  try { return data?.value ? JSON.parse(data.value) : []; } catch { return []; }
}

// Deletes every row tagged with this batch across all four tables — children
// (payments, visits) before parents (patients) so FK constraints never block it.
export async function rollbackImportBatch(batchId: string) {
  const results: Record<string, number> = {};
  for (const table of ["payments", "visits", "leads", "patients"] as const) {
    const { data } = await supabase.from(table).delete().eq("imported_batch", batchId).select("id");
    results[table] = data?.length ?? 0;
  }
  const batches = await fetchImportBatches();
  await upsertSetting("import_batches", JSON.stringify(batches.filter((b) => b.batchId !== batchId)));
  return results;
}

// ----- Leads -----
export interface ImportLeadRow { name: string; mobile: string; source?: string; note?: string }

// Checks which of the given mobile numbers already exist in a table, in
// chunks (avoids PostgREST's request-size limits with very long lists).
// This scales correctly to any existing table size — a plain
// .select("mobile") with no filter would get silently capped at ~1000
// rows by Supabase's default, which meant duplicate-checking against a
// patients/leads table bigger than that would miss everything beyond
// row 1000. Critical once real volume (tens of thousands of leads/
// patients) is being imported.
async function findExistingMobiles(table: "patients" | "leads", mobiles: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const CHUNK = 300;
  const uniqueMobiles = Array.from(new Set(mobiles.filter((m) => m.length === 10)));
  for (let i = 0; i < uniqueMobiles.length; i += CHUNK) {
    const chunk = uniqueMobiles.slice(i, i + CHUNK);
    const { data } = await supabase.from(table).select("mobile").in("mobile", chunk);
    (data ?? []).forEach((r: any) => found.add(normalizeMobile(r.mobile)));
  }
  return found;
}

export async function previewLeadsImport(rows: ImportLeadRow[]) {
  const candidateMobiles = rows.map((r) => normalizeMobile(r.mobile));
  const [existingLeads, existingPatients] = await Promise.all([
    findExistingMobiles("leads", candidateMobiles),
    findExistingMobiles("patients", candidateMobiles),
  ]);
  const known = new Set([...existingLeads, ...existingPatients]);
  const seen = new Set<string>();
  const valid: ImportLeadRow[] = [];
  let duplicates = 0, invalid = 0;
  const invalidSamples: string[] = [];
  for (const r of rows) {
    const mobile = normalizeMobile(r.mobile);
    if (!r.name.trim() || mobile.length !== 10) {
      invalid++;
      if (invalidSamples.length < 5) invalidSamples.push(`${r.name || "(no name)"} — ${r.mobile || "(no mobile)"}`);
      continue;
    }
    if (known.has(mobile) || seen.has(mobile)) { duplicates++; continue; }
    seen.add(mobile);
    valid.push({ ...r, mobile });
  }
  return { valid, duplicates, invalid, invalidSamples, total: rows.length };
}

export async function commitLeadsImport(
  rows: ImportLeadRow[],
  batchId: string,
  onProgress?: (done: number, total: number) => void,
) {
  const BATCH = 500; // bumped for 30k+ scale imports — fewer round trips
  let imported = 0;
  try {
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map((r) => ({
        name: r.name.trim(),
        mobile: r.mobile,
        source: r.source?.trim() || "Bulk Import",
        status: "Cold",
        note: r.note?.trim() || null,
        imported_batch: batchId,
      }));
      const { error } = await supabase.from("leads").insert(chunk);
      if (error) throw error;
      imported += chunk.length;
      onProgress?.(imported, rows.length);
    }
  } catch (e: any) {
    // At scale (thousands of rows), a failure partway through has
    // already committed everything before it — the error must say so,
    // instead of implying the whole import did nothing.
    throw new Error(`${imported} of ${rows.length} leads import ho chuke the jab error aaya: ${e?.message ?? e}`);
  }
  return imported;
}

// ----- Patients -----
export interface ImportPatientRow {
  name: string; mobile: string; age?: string; gender?: string; city?: string;
  primary_disease?: string; branch?: string;
}

export async function previewPatientsImport(rows: ImportPatientRow[], defaultBranch: string) {
  const candidateMobiles = rows.map((r) => normalizeMobile(r.mobile));
  const known = await findExistingMobiles("patients", candidateMobiles);
  const seen = new Set<string>();
  const valid: (ImportPatientRow & { mobile: string; branch: string })[] = [];
  let duplicates = 0, invalid = 0;
  const invalidSamples: string[] = [];
  for (const r of rows) {
    const mobile = normalizeMobile(r.mobile);
    if (!r.name.trim() || mobile.length !== 10) {
      invalid++;
      if (invalidSamples.length < 5) invalidSamples.push(`${r.name || "(no name)"} — ${r.mobile || "(no mobile)"}`);
      continue;
    }
    if (known.has(mobile) || seen.has(mobile)) { duplicates++; continue; }
    seen.add(mobile);
    const branch = (r.branch?.trim().toUpperCase().replace(/\s+/g, "_") || defaultBranch) as string;
    valid.push({ ...r, mobile, branch: branch === "BAJAJ_NAGAR" || branch === "JAGATPURA" ? branch : defaultBranch });
  }
  return { valid, duplicates, invalid, invalidSamples, total: rows.length };
}

export async function commitPatientsImport(
  rows: (ImportPatientRow & { mobile: string; branch: string })[],
  batchId: string,
  onProgress?: (done: number, total: number) => void,
) {
  const { count } = await supabase.from("patients").select("id", { count: "exact", head: true });
  let seq = 1000 + (count ?? 0) + 1;
  const BATCH = 500; // bumped for 30k+ scale imports — fewer round trips
  let imported = 0;
  try {
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map((r) => ({
        patient_code: `YHC-${seq++}`,
        name: r.name.trim(),
        mobile: r.mobile,
        age: r.age ? Number(r.age) || null : null,
        gender: r.gender?.trim() || null,
        city: r.city?.trim() || null,
        primary_disease: r.primary_disease?.trim() || null,
        wa_consent: false, // legacy records — no fresh consent captured, deliberately safe default
        branch: r.branch,
        lifetime_visits: 0,
        lifetime_revenue: 0,
        current_balance: 0,
        imported_batch: batchId,
      }));
      const { error } = await supabase.from("patients").insert(chunk);
      if (error) throw error;
      imported += chunk.length;
      onProgress?.(imported, rows.length);
    }
  } catch (e: any) {
    throw new Error(`${imported} of ${rows.length} patients import ho chuke the jab error aaya: ${e?.message ?? e}`);
  }
  return imported;
}

// ----- Visit / Revenue history (run AFTER patients exist — matches by mobile) -----
export interface ImportVisitRow {
  mobile: string; visit_date: string; chief_complaint?: string;
  amount_charged?: string; amount_received?: string; payment_mode?: string;
}

export async function previewVisitHistoryImport(rows: ImportVisitRow[]) {
  const candidateMobiles = Array.from(new Set(rows.map((r) => normalizeMobile(r.mobile)).filter((m) => m.length === 10)));
  const byMobile = new Map<string, { id: string; mobile: string; branch: string }>();
  const CHUNK = 300;
  for (let i = 0; i < candidateMobiles.length; i += CHUNK) {
    const chunk = candidateMobiles.slice(i, i + CHUNK);
    const { data } = await supabase.from("patients").select("id,mobile,branch").in("mobile", chunk);
    (data ?? []).forEach((p: any) => byMobile.set(normalizeMobile(p.mobile), p));
  }
  let unmatched = 0;
  const unmatchedSamples: string[] = [];
  const valid: (ImportVisitRow & { patient_id: string; branch: string })[] = [];
  for (const r of rows) {
    const mobile = normalizeMobile(r.mobile);
    const p = byMobile.get(mobile);
    if (!p || !r.visit_date?.trim()) {
      unmatched++;
      if (unmatchedSamples.length < 5) unmatchedSamples.push(r.mobile || "(no mobile)");
      continue;
    }
    valid.push({ ...r, mobile, patient_id: p.id, branch: p.branch });
  }
  return { valid, unmatched, unmatchedSamples, total: rows.length };
}

// Any payment mode outside the 3 the app itself ever writes (CASH/UPI/CARD)
// gets bucketed as OTHER instead of being written as arbitrary free text —
// otherwise it silently doesn't match any category in the cash/upi/card
// breakdown on Owner Reports/Day Summary (total revenue still included it
// either way, but the breakdown wouldn't add up to the total).
const KNOWN_PAYMENT_MODES = ["CASH", "UPI", "CARD"];
export function normalizePaymentMode(m?: string | null): string {
  const up = (m ?? "").trim().toUpperCase();
  return KNOWN_PAYMENT_MODES.includes(up) ? up : up ? "OTHER" : "CASH";
}

export async function commitVisitHistoryImport(
  rows: (ImportVisitRow & { patient_id: string; branch: string })[],
  batchId: string,
  onProgress?: (done: number, total: number, phase: "visits" | "totals") => void,
) {
  const BATCH = 300; // bumped for large-scale imports — fewer round trips
  let visitsImported = 0, paymentsImported = 0;
  const touched = new Set<string>();

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const visitInserts = chunk.map((r) => ({
      patient_id: r.patient_id,
      visit_date: r.visit_date,
      visit_type: "OPD",
      visit_status: "DONE",
      branch: r.branch,
      chief_complaint: r.chief_complaint?.trim() || null,
      imported_batch: batchId,
    }));
    const { data: inserted, error } = await supabase.from("visits").insert(visitInserts).select("id,patient_id");
    if (error) throw new Error(`${visitsImported} of ${rows.length} visits import ho chuke the jab error aaya: ${error.message}`);
    visitsImported += inserted?.length ?? 0;
    onProgress?.(visitsImported, rows.length, "visits");

    const paymentInserts: any[] = [];
    (inserted ?? []).forEach((v: any, idx: number) => {
      const src = chunk[idx];
      touched.add(v.patient_id);
      const charged = Number(src.amount_charged ?? src.amount_received ?? 0);
      const received = Number(src.amount_received ?? 0);
      if (charged > 0 || received > 0) {
        paymentInserts.push({
          visit_id: v.id,
          patient_id: v.patient_id,
          amount_charged: charged,
          amount_received: received,
          balance_due: Math.max(0, charged - received),
          payment_mode: normalizePaymentMode(src.payment_mode),
          branch: src.branch,
          notes: "Bulk imported (visit history)",
          imported_batch: batchId,
        });
      }
    });
    if (paymentInserts.length) {
      const { error: pe } = await supabase.from("payments").insert(paymentInserts);
      if (pe) throw new Error(`${visitsImported} visits already imported, but a payments batch failed: ${pe.message}`);
      paymentsImported += paymentInserts.length;
    }
  }

  // Recompute lifetime totals for every patient touched by this import,
  // a few at a time so we don't hammer the DB with hundreds of parallel calls.
  const ids = Array.from(touched);
  const CONCURRENCY = 8;
  const totalsFailedFor: string[] = [];
  let totalsDone = 0;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    await Promise.all(
      ids.slice(i, i + CONCURRENCY).map(async (patientId) => {
        const [{ count: visitCount }, { data: pays }, { data: lastVisit }] = await Promise.all([
          supabase.from("visits").select("id", { count: "exact", head: true }).eq("patient_id", patientId),
          supabase.from("payments").select("amount_received,balance_due").eq("patient_id", patientId),
          supabase.from("visits").select("visit_date").eq("patient_id", patientId).order("visit_date", { ascending: false }).limit(1).maybeSingle(),
        ]);
        const revenue = (pays ?? []).reduce((s: number, p: any) => s + Number(p.amount_received || 0), 0);
        const balance = (pays ?? []).reduce((s: number, p: any) => s + Number(p.balance_due || 0), 0);
        const { error: updErr } = await supabase
          .from("patients")
          .update({
            lifetime_visits: visitCount ?? 0,
            lifetime_revenue: revenue,
            current_balance: balance,
            last_visit_date: lastVisit?.visit_date ?? null,
          })
          .eq("id", patientId);
        // Don't fail the whole batch over one patient's totals update —
        // the visits/payments themselves already imported successfully.
        // But don't silently claim success either; surface which patients
        // need a manual re-check.
        if (updErr) totalsFailedFor.push(patientId);
        totalsDone++;
        onProgress?.(totalsDone, ids.length, "totals");
      }),
    );
  }

  return { visitsImported, paymentsImported, patientsUpdated: touched.size - totalsFailedFor.length, totalsFailedFor };
}


export async function searchPatients(term: string) {
  // Comma/parens break PostgREST's .or() filter syntax outright. % and _
  // are ILIKE wildcards — a literal one in the search box (e.g. "50%" or
  // "type_A") would silently widen the match instead of erroring, giving
  // confusingly broad results rather than the expected ones.
  const t = sanitizeOrFilterTerm(term);
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

export async function fetchPatientsByIds(ids: string[]): Promise<{ id: string; name: string; patient_code: string | null }[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("patients").select("id,name,patient_code").in("id", ids);
  if (error) return [];
  return data ?? [];
}

// ---------- Family linking ----------
export async function fetchFamilyMembers(patientId: string) {
  const me = await fetchPatientById(patientId);
  if (!me?.family_group_id) return [];
  const { data, error } = await supabase
    .from("patients")
    .select("id, name, mobile, age, gender, family_relationship, last_visit_date, patient_code")
    .eq("family_group_id", me.family_group_id)
    .neq("id", patientId);
  if (error) return [];
  return data ?? [];
}

/**
 * Links two patients into the same family group. If neither has a group
 * yet, creates one. `relatedRelationship` describes what the OTHER patient
 * is relative to this family (e.g. "Spouse", "Son") — shown on both profiles.
 */
export async function linkFamilyMember(patientId: string, relatedPatientId: string, relatedRelationship: string) {
  const me = await fetchPatientById(patientId);
  if (!me) return { success: false, error: "Patient not found" };

  let groupId = me.family_group_id;
  if (!groupId) {
    groupId = crypto.randomUUID();
    const { error: e1 } = await supabase
      .from("patients")
      .update({ family_group_id: groupId, family_relationship: me.family_relationship ?? "Head" })
      .eq("id", patientId);
    if (e1) return { success: false, error: e1.message };
  }

  const { error: e2 } = await supabase
    .from("patients")
    .update({ family_group_id: groupId, family_relationship: relatedRelationship })
    .eq("id", relatedPatientId);
  if (e2) return { success: false, error: e2.message };

  return { success: true, error: null };
}

export async function unlinkFamilyMember(patientId: string) {
  const { error } = await supabase
    .from("patients")
    .update({ family_group_id: null, family_relationship: null })
    .eq("id", patientId);
  return { success: !error, error: error?.message ?? null };
}

// ---------- Patient Documents (general staff upload — follow-up notes, new case notes, reports) ----------
// Lets Dr. Yadav keep writing on paper; any staff with access to this
// screen just photographs the page against the right patient. Reuses the
// same compress + scan-enhance + upload-timeout pipeline as case-taking
// photos, so this needs no separate tuning.
export const DOC_TYPES = ["Follow-up Notes", "New Case Notes", "Lab Report", "Other"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export interface PatientDocument {
  id: string;
  patient_id: string;
  doc_type: string;
  photo_url: string;
  note: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export async function uploadPatientDocument(
  patientId: string,
  docType: DocType,
  file: File,
  note?: string,
  uploadedBy?: string,
) {
  try {
    const compressed = await compressImageForUpload(file, { documentMode: true });
    const ext = compressed.name.split(".").pop() || "jpg";
    const path = `${patientId}/${Date.now()}.${ext}`;
    const { error: upErr } = await withTimeout(
      supabase.storage.from("patient-documents").upload(path, compressed, { upsert: true }),
      25_000,
      "Document upload",
    );
    if (upErr) return { success: false, error: upErr.message };
    const { data: pub } = supabase.storage.from("patient-documents").getPublicUrl(path);
    const { error } = await supabase.from("patient_documents").insert({
      patient_id: patientId,
      doc_type: docType,
      photo_url: pub.publicUrl,
      note: note?.trim() || null,
      uploaded_by: uploadedBy || null,
    });
    if (error) return { success: false, error: error.message };
    return { success: true, error: null };
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Upload failed" };
  }
}

export async function fetchPatientDocuments(patientId: string): Promise<PatientDocument[]> {
  const { data, error } = await supabase
    .from("patient_documents")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return data ?? [];
}

export async function deletePatientDocument(id: string) {
  const { error } = await supabase.from("patient_documents").delete().eq("id", id);
  return { success: !error, error: error?.message ?? null };
}

export async function fetchDaySummary(branch?: string) {
  const t = today();
  let visQ = supabase.from("visits").select("id,patient_id,visit_status,branch").eq("visit_date", t);
  let payQ = supabase
    .from("payments")
    .select("visit_id,amount_received,amount_charged,balance_due,branch,payment_mode")
    .gte("created_at", istDayStart(t));
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
  // Anything outside CASH/UPI/CARD (e.g. NEFT/QR from a bulk-imported
  // historical record) still counts toward total revenue above, but
  // wouldn't show up in any of the 3 named buckets — this bucket exists
  // so cash+upi+card+other always adds back up to the total.
  const other = pays.filter((r: any) => !["CASH", "UPI", "CARD"].includes(r.payment_mode)).reduce((s, r: any) => s + Number(r.amount_received ?? 0), 0);
  // "Completed today" = visits actually paid off today (balance hit 0
  // today), whether that visit was registered today or carried over from
  // an earlier day. Counting only visits.visit_status === "DONE" AND
  // visit_date === today would miss the exact carried-over case this
  // audit flagged (case taken days ago, finally settled today).
  const doneToday = new Set(pays.filter((r: any) => r.balance_due === 0).map((r: any) => r.visit_id)).size;
  return {
    totalPatients: visits.length,
    newPatients: newCount,
    followupPatients: followupCount,
    done: doneToday,
    waiting: visits.filter((v: any) => ["REGISTERED", "CASE_TAKING", "WAITING", "WAITING_DOCTOR"].includes(v.visit_status)).length,
    pendingPayments: visits.filter((v: any) => v.visit_status === "PAYMENT").length,
    revenue,
    outstanding,
    cash,
    upi,
    card,
    other,
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

