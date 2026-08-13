import { supabase, today, istNow } from "./supabase";

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
  card_series: string | null;
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
  // Set at Case-DR time (doctor.case.form.$token.tsx) -- were already
  // coming through fetchVisit()'s select("*") at runtime, just not typed
  // here, which is why the prescribing screen never rendered them (audit
  // 03 Aug 2026: "photo upload ki thi, doctor prescribing mein nahi
  // dikh rahi").
  case_photo_url?: string | null;
  tongue_photo_url?: string | null;
  reports_photo_url?: string | null;
  // Rx Autosave (03 Aug 2026 backlog item B) -- migration 0022. Whole draft
  // written as one JSON blob (rows/notes/next-visit/etc), cleared to null
  // by submit_prescription_atomic() the moment the Rx is actually submitted.
  // Undefined-safe: on a pre-migration DB this key just won't be present
  // in the row and every read below already treats that as "no draft".
  rx_draft?: RxDraft | null;
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
  start_offset_days?: number | null;
  remarks: string | null;
  created_at: string;
}

// ---------- Patient registration ----------
// Used only by the legacy fallback path (register_patient_with_visit RPC
// missing) and by bulk import. Both used to guess the next number from a
// single count() read -- if a live registration and a bulk import (or two
// imports) landed at the same moment, they could compute the same
// patient_code (audit P0-3 remainder, the "bulk-import path not touched"
// part). next_patient_codes() reserves numbers from a real Postgres
// sequence, which is atomic under concurrency by construction -- no row
// locking needed. Falls back to the old (racy) approach only until that
// SQL migration is run, same not-hard-fail pattern as the RPC above.
export async function nextPatientCode(): Promise<string> {
  const { data, error } = await supabase.rpc("next_patient_codes", { p_count: 1 });
  if (!error && Array.isArray(data) && data[0]) return data[0] as string;
  logDegradedModeAlert("next_patient_codes");
  const { count } = await supabase.from("patients").select("id", { count: "exact", head: true });
  return `YHC-${1000 + (count ?? 0) + 1}`;
}

export async function nextTokenForToday(branch: string): Promise<string> {
  // Was a plain count()+1 — same race class as the old patient_code bug
  // (audit finding, re-audit 29 Jul): two simultaneous registrations at
  // the same branch could compute the same token (T-05, T-05). Now an
  // atomic RPC (a real per-branch-per-day counter row, incremented with
  // ON CONFLICT ... DO UPDATE, which Postgres serializes safely).
  // Falls back to the old racy count() only until that SQL is run.
  const { data, error } = await supabase.rpc("next_token_for_day", { p_branch: branch, p_date: today() });
  if (!error && typeof data === "string") return data;
  logDegradedModeAlert("next_token_for_day", { branch });

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
export async function autoConvertMatchingLead(patientId: string, mobile: string, mobileCountryCode?: string | null): Promise<void> {
  // Phase 1 #6 — +91 prefix mismatch guard. The leads table has no
  // mobile_country_code column at all: every lead in it (JustDial,
  // manual entry, bulk import) is implicitly assumed to be a +91 Indian
  // 10-digit number. Matching purely on the raw digits, with no country
  // check, risks converting an unrelated lead that happens to share the
  // same 10 digits under a different country code. The register.tsx
  // caller already guarded this at the call site (only calls for +91
  // patients) — moved the guard IN here too so it's structurally
  // guaranteed even if a future caller (e.g. the returning-patient
  // check-in flow) forgets to check first.
  if (mobileCountryCode && mobileCountryCode !== "+91") return;
  try {
    const { error } = await supabase
      .from("leads")
      .update({ status: "CONVERTED", converted_patient_id: patientId })
      .eq("mobile", mobile)
      .neq("status", "CONVERTED");
    if (error) console.error("autoConvertMatchingLead failed:", error.message);
  } catch (e: any) {
    console.error("autoConvertMatchingLead threw:", e?.message ?? e);
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
  const { data, error } = await supabase
    .from("patients")
    .select("id, name, patient_code")
    .eq("mobile", mobile)
    .eq("mobile_country_code", countryCode)
    .maybeSingle();
  // A failed lookup is NOT the same as "genuinely no such patient" — the
  // caller (registration's duplicate-check hint) would otherwise silently
  // treat a network hiccup as "safe to register as new," risking a
  // duplicate patient record for someone who actually already exists.
  // Kept non-throwing (this is a live-typing hint, not a hard gate) but
  // now at least visible for debugging.
  if (error) console.error("findPatientByMobile failed:", error.message);
  return data ?? null;
}

export async function checkInExistingPatient(input: {
  patient_id: string;
  branch: "BAJAJ_NAGAR" | "JAGATPURA";
  chief_complaint?: string;
  case_channel?: "WALK_IN" | "ONLINE";
}): Promise<{ visit: DBVisit }> {
  // Token generation + visit insert + lifetime_visits bump + follow-up
  // closure all happen inside one Postgres function now — this was the
  // one live (non-fallback) path still generating T-XX tokens with a
  // plain client-side count()+1, so two simultaneous check-ins at the
  // same branch could land on the same token number.
  const { data, error } = await supabase.rpc("check_in_existing_patient_atomic", {
    p_patient_id: input.patient_id,
    p_branch: input.branch,
    p_chief_complaint: input.chief_complaint ?? null,
    p_visit_date: today(),
  });
  if (!error && data) {
    let visit = data as DBVisit;
    if (input.case_channel === "ONLINE") {
      // FIXED 06 Aug: was writing visit_type="ONLINE" — visits_visit_type_check
      // only allows OPD/FOLLOWUP/VIDEO/DELIVERY, so this UPDATE has been
      // silently failing (error wasn't even checked here) on every online
      // check-in. Effect: every video consultation kept whatever visit_type
      // the RPC set by default (OPD), so feeKindForVisit() never classified
      // it as ONLINE and it got billed the wrong fee. "ONLINE" stays the
      // app-level case_channel value (that's just this function's own
      // parameter contract, not a DB value) — only the DB write changes.
      const { data: updatedVisit, error: onlineErr } = await supabase
        .from("visits")
        .update({ visit_type: "VIDEO" })
        .eq("id", visit.id)
        .select("*")
        .maybeSingle();
      if (onlineErr) console.error("Marking visit as VIDEO failed:", onlineErr.message);
      if (updatedVisit) visit = updatedVisit as DBVisit;
    }
    return { visit };
  }
  // Fall back to the old approach only if the RPC isn't deployed yet
  // (SQL migration not run) — check-in must never hard-fail just because
  // a migration is pending. Same pattern as createPatientWithVisit.
  const isMissingFunction = error?.code === "42883" || /function .* does not exist/i.test(error?.message ?? "");
  if (!isMissingFunction) throw error ?? new Error("Check-in fail hua");
  logDegradedModeAlert("check_in_existing_patient_atomic", { patient_id: input.patient_id });
  return checkInExistingPatientLegacy(input);
}

async function checkInExistingPatientLegacy(input: {
  patient_id: string;
  branch: "BAJAJ_NAGAR" | "JAGATPURA";
  chief_complaint?: string;
  case_channel?: "WALK_IN" | "ONLINE";
}): Promise<{ visit: DBVisit }> {
  const token = await nextTokenForToday(input.branch);
  const { data: v, error: ve } = await supabase
    .from("visits")
    .insert({
      patient_id: input.patient_id,
      visit_date: today(),
      visit_type: input.case_channel === "ONLINE" ? "VIDEO" : "OPD", // FIXED 06 Aug — visits_visit_type_check has no "ONLINE"
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
  } catch (e: any) {
    console.error("checkInExistingPatientLegacy: lifetime_visits bump failed:", e?.message ?? e);
  }
  try {
    // Item #8: patient is physically here now, so any reminder still
    // pending for them is moot — stop it from firing later today.
    await supabase.from("followups").update({ status: "DONE" }).eq("patient_id", input.patient_id).eq("status", "PENDING");
  } catch (e: any) {
    console.error("checkInExistingPatientLegacy: followup closure failed:", e?.message ?? e);
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
  // Online-case tracking (Dr. Yadav, 29 Jul 2026) — was entirely
  // paper-based before, which is exactly why cases went missing for
  // 10-20 days. Defaults to walk-in so every existing caller keeps
  // working unchanged.
  case_channel?: "WALK_IN" | "ONLINE";
  // TASK 5 — where this patient came from (Walk-in, Referral, JustDial, ...).
  lead_source?: string;

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
    // TASK 5 — kept as its own write on purpose: lead_source only exists
    // after migration 0018, and folding it into the block above would make
    // an un-migrated DB reject the whole update and silently lose the
    // WhatsApp/DOB/profession fields too.
    if (input.lead_source) {
      const { data: srcUpdated, error: srcErr } = await supabase
        .from("patients")
        .update({ lead_source: input.lead_source })
        .eq("id", patient.id)
        .select("*")
        .maybeSingle();
      if (srcErr) console.error("lead_source save failed (migration 0018 pending?):", srcErr.message);
      if (srcUpdated) patient = srcUpdated as DBPatient;
    }

    let visit = data.visit as DBVisit;
    if (input.case_channel === "ONLINE") {
      // FIXED 06 Aug — see checkInExistingPatient's identical fix for the
      // full explanation: DB constraint has no "ONLINE", only "VIDEO".
      const { data: updatedVisit, error: onlineErr } = await supabase
        .from("visits")
        .update({ visit_type: "VIDEO" })
        .eq("id", visit.id)
        .select("*")
        .maybeSingle();
      if (onlineErr) console.error("Marking visit as VIDEO failed:", onlineErr.message);
      if (updatedVisit) visit = updatedVisit as DBVisit;
    }
    return { patient, visit };
  }
  // Fall back to the old two-step approach if the RPC isn't deployed yet
  // (SQL migration not run) — registration must never hard-fail just
  // because a database migration is pending. Postgres error 42883 =
  // "function does not exist"; PostgREST surfaces this distinctly, so we
  // only silently fall back for that specific case and still throw for
  // any other (real) RPC error.
  const isMissingFunction = error?.code === "42883" || /function .* does not exist/i.test(error?.message ?? "");
  if (!isMissingFunction) throw error ?? new Error("Registration fail hui");
  logDegradedModeAlert("register_patient_with_visit", { mobile: input.mobile });
  const legacy = await createPatientWithVisitLegacy(input);
  if (input.lead_source) {
    // Best-effort, same reasoning as the atomic path above.
    const { data: srcUpdated, error: srcErr } = await supabase
      .from("patients")
      .update({ lead_source: input.lead_source })
      .eq("id", legacy.patient.id)
      .select("*")
      .maybeSingle();
    if (srcErr) console.error("lead_source save failed (migration 0018 pending?):", srcErr.message);
    if (srcUpdated) legacy.patient = srcUpdated as DBPatient;
  }
  return legacy;

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
  case_channel?: "WALK_IN" | "ONLINE";
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
      visit_type: input.case_channel === "ONLINE" ? "VIDEO" : "OPD", // FIXED 06 Aug — visits_visit_type_check has no "ONLINE"
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
  // Block 3: registration already refuses duplicate mobiles, but this edit
  // path did not — so a correction could quietly point two patient records
  // at the same number and break every WhatsApp/lookup flow keyed on it.
  if (fields.mobile) {
    const dup = await isDuplicateMobile(
      fields.mobile,
      fields.mobile_country_code ?? "+91",
      patientId,
    );
    if (dup) {
      return { success: false, error: "Yeh mobile number kisi aur patient pe already registered hai.", patient: null };
    }
  }
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
  const d = istNow();
  d.setUTCDate(d.getUTCDate() - 30);
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
  const { data, error } = await supabase.from("settings").select("value").eq("key", "case_dr_levels").maybeSingle();
  if (error) console.error("fetchCaseDrLevels failed:", error.message);
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

const CASE_DR_SAFE_PATIENT_FIELDS = "id, name, age, gender, primary_disease, card_series, card_number, card_register";

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
  // Was a fixed "CASH"|"UPI"|"CARD" union — modes are now Owner-managed
  // (payment_modes table), so any active mode code is valid here. For a
  // split payment this is the "primary"/summary mode stored on the
  // payments row itself; the real breakdown lives in payment_splits.
  payment_mode: string;
  branch: string;
  notes?: string;
  // Phase 1 #1: credit consumption now happens INSIDE this same RPC/
  // transaction (see migration 0012), not as a separate apply-then-revert
  // pair of calls. Pass how much credit to apply here — the DB locks and
  // consumes the patient's CREDIT_AVAILABLE rows atomically alongside the
  // payment insert, so there's no window where credit is "applied" but no
  // payment exists (or vice versa).
  credit_to_apply?: number;
  // 04 Aug 2026 fix: caller generates one UUID per payment-screen visit
  // (not per click) and reuses it across retries of that same submission.
  // Lets collect_payment_atomic recognise "this exact attempt already
  // went through" and return the original result instead of inserting a
  // second payment row — closes the partial-payment double-submit gap
  // (full payments were already accidentally protected by the DONE guard,
  // partial ones weren't). Optional so old callers keep working unchanged.
  idempotency_key?: string;
  // Multiple payment modes in one collection (e.g. ₹2000 cash + ₹1000
  // Paytm) — 10 Aug 2026. Must sum EXACTLY to amount_received or the RPC
  // rejects the whole call (Dr. Yadav's decision — no rounding slack).
  // Omitted/undefined = single-mode payment, same as before this existed.
  splits?: { mode: string; amount: number }[];
}) {
  // Payment insert + credit consumption + patient-totals recompute +
  // visit-status update all happen inside ONE Postgres function
  // (collect_payment_atomic), which runs as a single transaction with
  // row-level locks on the visit, patient, and credit rows. If any step
  // fails, Postgres rolls back everything — no window where money is
  // recorded but the visit/patient are stale, and no race where two
  // simultaneous payments (or two simultaneous credit spends) for the
  // same patient clobber each other. current_balance is always recomputed
  // as SUM(payments.balance_due) for the patient, not overwritten from
  // just this visit, so older outstanding dues are never wiped.
  const baseArgs = {
    p_visit_id: input.visit_id,
    p_patient_id: input.patient_id,
    p_amount_charged: input.amount_charged,
    p_amount_received: input.amount_received,
    p_payment_mode: input.payment_mode,
    p_branch: input.branch,
    p_notes: input.notes ?? null,
    p_credit_to_apply: input.credit_to_apply ?? 0,
    p_splits: input.splits && input.splits.length > 0 ? input.splits : null,
  };

  let data: any, error: any;
  if (input.idempotency_key) {
    ({ data, error } = await supabase.rpc("collect_payment_atomic", {
      ...baseArgs,
      p_idempotency_key: input.idempotency_key,
    }));
    // Trailing-param gap only: migration 0025 (adds p_idempotency_key)
    // deploys via a separate manual SQL step, but this code deploys the
    // moment it's pushed (Vercel auto-deploy) — there will be a real
    // window where the client sends a 9th arg the live function doesn't
    // have yet. Retrying the SAME atomic RPC without that one arg is not
    // the racy multi-step client fallback (collectPayment still refuses
    // that entirely, below) — it's just running one version behind on
    // the idempotency layer specifically, same trailing-default pattern
    // migration 0012 already established for p_credit_to_apply.
    const isMissingParam = error?.code === "42883" || /function .* does not exist/i.test(error?.message ?? "");
    if (error && isMissingParam) {
      logDegradedModeAlert("collect_payment_atomic_idempotency_key", { visit_id: input.visit_id });
      ({ data, error } = await supabase.rpc("collect_payment_atomic", baseArgs));
    }
  } else {
    ({ data, error } = await supabase.rpc("collect_payment_atomic", baseArgs));
  }
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

// ---------- Payment modes (Owner-managed) + split breakdown ----------
// 10 Aug 2026: payment_mode used to be a fixed CASH/UPI/CARD union baked
// into the type system and every report. Owner can now add modes (e.g.
// Paytm) from Settings; CASH/UPI/CARD stay as protected system defaults
// (is_system=true) since they're still referenced as literal strings in
// CSV-import normalization elsewhere.
export interface PaymentMode {
  id: string;
  code: string;
  label: string;
  is_active: boolean;
  is_system: boolean;
  sort_order: number;
}

export async function fetchPaymentModes(activeOnly = false): Promise<PaymentMode[]> {
  let q = supabase.from("payment_modes").select("*").order("sort_order", { ascending: true });
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as PaymentMode[];
}

export async function addPaymentMode(code: string, label: string) {
  const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  if (!cleanCode || !label.trim()) return { success: false, error: "Code aur label dono chahiye" };
  const { data: existing } = await supabase.from("payment_modes").select("id").eq("code", cleanCode).maybeSingle();
  if (existing) return { success: false, error: "Ye code already exist karta hai" };
  const { data: maxRow } = await supabase.from("payment_modes").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("payment_modes").insert({
    code: cleanCode,
    label: label.trim(),
    sort_order: (maxRow?.sort_order ?? 0) + 1,
  });
  return { success: !error, error: error?.message ?? null };
}

export async function setPaymentModeActive(id: string, isActive: boolean) {
  const { error } = await supabase.from("payment_modes").update({ is_active: isActive }).eq("id", id);
  return { success: !error, error: error?.message ?? null };
}

// Deleting a mode that's already been used on real payments would orphan
// payment_splits.mode values that no report could label anymore —
// deactivating (above) is the safe removal path. This is only reachable
// for modes that were added and then never actually used.
export async function deletePaymentMode(id: string) {
  const { data: mode } = await supabase.from("payment_modes").select("code, is_system").eq("id", id).maybeSingle();
  if (!mode) return { success: false, error: "Mode nahi mila" };
  if (mode.is_system) return { success: false, error: "Cash/UPI/Card ko delete nahi kar sakte — deactivate kar sakte ho" };
  const { count } = await supabase.from("payment_splits").select("id", { count: "exact", head: true }).eq("mode", mode.code);
  if ((count ?? 0) > 0) return { success: false, error: "Ye mode already use ho chuka hai — delete nahi, sirf deactivate kar sakte ho" };
  const { error } = await supabase.from("payment_modes").delete().eq("id", id);
  return { success: !error, error: error?.message ?? null };
}

export interface ModeBreakdown { mode: string; label: string; amount: number }

// Shared by every report/dashboard that shows a Cash/UPI/Card/... split.
// Reads from payment_splits (which has one row per mode per payment, for
// every payment — split or not, backfilled for history too — see
// migration 0037) instead of payments.payment_mode directly, so a payment
// split across multiple modes counts correctly in each mode's own bucket.
// Every active mode is included even at ₹0 (so the UI always shows a
// consistent set of rows); any mode with real history that's since been
// deactivated/removed from payment_modes still appears using its raw code
// as the label, so old money is never silently dropped from a report.
export async function fetchModeBreakdown(paymentIds: string[]): Promise<ModeBreakdown[]> {
  const modes = await fetchPaymentModes();
  if (paymentIds.length === 0) {
    return modes.filter((m) => m.is_active).map((m) => ({ mode: m.code, label: m.label, amount: 0 }));
  }
  const { data: splits, error } = await supabase.from("payment_splits").select("mode,amount").in("payment_id", paymentIds);
  if (error) return modes.filter((m) => m.is_active).map((m) => ({ mode: m.code, label: m.label, amount: 0 }));
  const byMode = new Map<string, number>();
  (splits ?? []).forEach((s: any) => byMode.set(s.mode, (byMode.get(s.mode) ?? 0) + Number(s.amount ?? 0)));
  const known = modes
    .filter((m) => m.is_active || (byMode.get(m.code) ?? 0) > 0)
    .map((m) => ({ mode: m.code, label: m.label, amount: byMode.get(m.code) ?? 0 }));
  const extraCodes = [...byMode.keys()].filter((c) => !modes.some((m) => m.code === c));
  const extra = extraCodes.map((c) => ({ mode: c, label: c, amount: byMode.get(c) ?? 0 }));
  return [...known, ...extra];
}

// ---------- Payment Adjustments — overpayment ledger (audit P0-6) ----------
// Overpayment used to be silently absorbed: if received > charged,
// balance_due just clamped to 0 and the extra money left no trace. Now
// a DB trigger on every `payments` insert (see 12_payment_adjustments.sql)
// auto-logs the difference here as PENDING — no code path can skip it,
// because it doesn't depend on the app remembering to check.
export interface PaymentAdjustment {
  id: string;
  patient_id: string;
  source_payment_id: string | null;
  visit_id: string | null;
  branch: string | null;
  amount: number;
  type: string;
  status: "PENDING" | "REFUNDED" | "CREDIT_AVAILABLE" | "APPLIED";
  resolution_method: "REFUND" | "CREDIT_NOTE" | null;
  resolved_by: string | null;
  resolved_at: string | null;
  applied_to_visit_id: string | null;
  applied_amount: number | null;
  notes: string | null;
  created_at: string;
  patient?: { name: string; mobile: string; patient_code: string | null };
}

export async function fetchPendingPaymentAdjustments(): Promise<PaymentAdjustment[]> {
  const { data, error } = await supabase
    .from("payment_adjustments")
    .select("*, patient:patients(name, mobile, patient_code)")
    .eq("status", "PENDING")
    .order("created_at", { ascending: true });
  if (error) return [];
  return (data ?? []) as PaymentAdjustment[];
}

// Owner decides once: REFUND closes it out (cash handed back outside the
// system), CREDIT_NOTE turns it into spendable credit for that patient's
// next visit. Both go through one RPC so "already resolved" can't race.
export async function resolvePaymentAdjustment(
  adjustmentId: string,
  method: "REFUND" | "CREDIT_NOTE",
  resolvedBy: string,
  notes?: string,
) {
  const { data, error } = await supabase.rpc("resolve_payment_adjustment", {
    p_adjustment_id: adjustmentId,
    p_method: method,
    p_resolved_by: resolvedBy,
    p_notes: notes ?? null,
  });
  if (error) return { success: false, error: error.message };
  return { success: true, error: null, result: data };
}

// Shown on the payment screen so reception knows there's credit to offer
// before asking the patient for fresh cash.
export async function fetchAvailableCredit(patientId: string): Promise<number> {
  const { data, error } = await supabase
    .from("payment_adjustments")
    .select("amount")
    .eq("patient_id", patientId)
    .eq("status", "CREDIT_AVAILABLE");
  if (error) return 0;
  return (data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
}

// DEPRECATED (Phase 1 #1, 29 Jul 2026 follow-up) — credit is now applied
// INSIDE collect_payment_atomic via the credit_to_apply param on
// collectPayment(), in the same transaction as the payment insert. That
// removed the two-step "apply, then hope collectPayment succeeds, else
// remember to revert" pattern these two functions implemented. Kept here
// (unused, no callers left in the app) only in case the old 2-RPC flow is
// ever needed again — safe to delete along with apply_available_credit /
// revert_credit_application in the DB once confirmed unneeded.
export async function applyAvailableCredit(patientId: string, visitId: string, requestedAmount: number): Promise<number> {
  if (requestedAmount <= 0) return 0;
  const { data, error } = await supabase.rpc("apply_available_credit", {
    p_patient_id: patientId,
    p_visit_id: visitId,
    p_requested_amount: requestedAmount,
  });
  if (error) throw error;
  return Number((data as any)?.applied ?? 0);
}

// DEPRECATED — see applyAvailableCredit note above. No longer called by
// the payment flow; the RPC transaction rollback now does this job.
export async function revertCreditApplication(visitId: string): Promise<void> {
  try {
    const { error } = await supabase.rpc("revert_credit_application", { p_visit_id: visitId });
    if (error) console.error("revertCreditApplication failed:", error.message);
  } catch (e: any) {
    console.error("revertCreditApplication threw:", e?.message ?? e);
  }
}

// ---------- Prescriptions ----------
export async function fetchInventorySearch(term: string, branch?: string) {

  const clean = sanitizeIlikeTerm(term);
  let q = supabase.from("inventory").select("*").limit(20);
  if (branch) q = q.eq("branch", branch);
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

// ---------- Patient Interaction Log (04 Aug 2026, Operational Manual Feature 2) ----------
// Records non-visit patient touchpoints — a phone call, verbal advice given
// in-clinic, a dose change told over WhatsApp, a query answered — none of
// which had anywhere to live before this. Standalone table (migration
// 0026): a patient can have interactions with no visit attached at all,
// so this isn't an extension of visits/followups. Reception logs these
// from the patient profile; Doctor logs them from the Rx screen (verbal
// dosing changes happen mid-consultation constantly).
export const INTERACTION_TYPES = ["CALL", "WHATSAPP_REPLY", "IN_CLINIC_VERBAL", "DOSE_CHANGE", "QUERY"] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];
export const INTERACTION_TYPE_LABELS: Record<InteractionType, string> = {
  CALL: "Call",
  WHATSAPP_REPLY: "WhatsApp Reply",
  IN_CLINIC_VERBAL: "In-Clinic Verbal",
  DOSE_CHANGE: "Dose Change",
  QUERY: "Query",
};

export interface PatientInteraction {
  id: string;
  patient_id: string;
  type: InteractionType;
  note: string;
  created_by: string | null;
  created_at: string;
}

export async function logPatientInteraction(
  patientId: string,
  type: InteractionType,
  note: string,
  createdBy?: string,
) {
  const { error } = await supabase.from("patient_interactions").insert({
    patient_id: patientId,
    type,
    note: note.trim(),
    created_by: createdBy || null,
  });
  return { success: !error, error: error?.message ?? null };
}

export async function fetchPatientInteractions(patientId: string, limit = 50): Promise<PatientInteraction[]> {
  const { data, error } = await supabase
    .from("patient_interactions")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as PatientInteraction[];
}

export interface RxRow {
  medicine_name: string;
  potency: string;
  dose: string;
  frequency: string;
  duration_days: number;
  is_slx: boolean;
  // Sequenced/staggered dosing (03 Aug 2026 backlog item D) -- how many
  // days after the Rx date this specific row actually starts. 0 = starts
  // same day (the old, only, behaviour). Only meaningful when the doctor
  // has turned "sequence" on for this Rx; otherwise every row stays 0.
  start_offset_days?: number;
  // SLX display fix (item E) -- previously an SLX row's medicine_name was
  // literally "SLX (Sulphur)" so it showed up as a fake medicine on the
  // pharmacy/patient screens. Now medicine_name is just "SLX" and remarks
  // carries which real medicine it's paired with, purely for context.
  remarks?: string | null;
}

// Rx Autosave (item B) -- exact shape of the draft JSON kept in
// visits.rx_draft. Mirrors the doctor.rx.consult screen's own local state
// 1:1 so hydrating a draft back into the form is a straight assignment.
export interface RxDraft {
  rows: {
    medicine_name: string;
    potency: string;
    dose: string;
    frequency: string;
    duration_num: number;
    duration_unit: "days" | "weeks" | "months";
  }[];
  slxOn: boolean;
  sequenced: boolean;
  notes: string;
  nextVisit: string;
  savedAt: string; // ISO timestamp, shown to the doctor as "Draft saved ..."
}

/**
 * Background write, debounced from the Rx screen -- never throws into the
 * UI (a failed autosave shouldn't interrupt someone writing a
 * prescription), just logs. Deliberately NOT run through
 * submit_prescription_atomic -- this is a lightweight single-column write,
 * not a state-transition, so it needs no transaction/locking of its own.
 */
export async function saveRxDraft(visitId: string, draft: RxDraft): Promise<boolean> {
  const { error } = await supabase.from("visits").update({ rx_draft: draft }).eq("id", visitId);
  if (error) {
    // Missing-column is expected until migration 0022 is run -- fail
    // silently in that case (no autosave yet, same as before this
    // feature existed) instead of spamming the console every few seconds.
    const missingColumn = error.code === "42703" || /column .*rx_draft.* does not exist/i.test(error.message ?? "");
    if (!missingColumn) console.error("saveRxDraft failed:", error.message);
    return false;
  }
  return true;
}

export async function submitPrescription(input: {
  visit_id: string;
  patient_id: string;
  rows: RxRow[];
  doctor_notes: string;
  next_visit_date: string | null;
}) {
  if (input.rows.length === 0) throw new Error("Add at least one medicine");

  // Now one atomic RPC: status guard + prescription insert + visit-status
  // update + patient.last_visit_date + case_discussed_at all happen in one
  // transaction. This used to be 3 separate writes — a crash between them
  // (e.g. prescriptions inserted but the visit-status update failing)
  // left medicine "prescribed" with the visit never reaching Pharmacy, or
  // the visit advancing without last_visit_date updating (which quietly
  // skews win-back cutoffs). case_discussed_at is new — it's what powers
  // the online-case pending-discussion tracking (Dr. Yadav, 29 Jul 2026).
  // Falls back to the old 3-step approach only until the SQL is run.
  const { error } = await supabase.rpc("submit_prescription_atomic", {
    p_visit_id: input.visit_id,
    p_patient_id: input.patient_id,
    p_rows: input.rows.map((r) => ({
      medicine_name: r.medicine_name,
      potency: r.potency,
      dose: r.dose,
      frequency: r.frequency,
      duration_days: r.duration_days,
      is_slx: r.is_slx,
      start_offset_days: r.start_offset_days ?? 0,
      remarks: r.remarks ?? null,
    })),
    p_doctor_notes: input.doctor_notes,
    p_next_visit_date: input.next_visit_date,
  });
  if (!error) return;

  const isMissingFunction = error?.code === "42883" || /function .* does not exist/i.test(error?.message ?? "");
  if (!isMissingFunction) throw error;
  logDegradedModeAlert("submit_prescription_atomic", { visit_id: input.visit_id });

  // ---- Legacy fallback (pre-atomic behaviour) ----
  const { data: existing, error: exErr } = await supabase
    .from("visits")
    .select("visit_status")
    .eq("id", input.visit_id)
    .maybeSingle();
  if (exErr) throw exErr;
  if (!existing) throw new Error("Visit not found");
  if (existing.visit_status === "PAYMENT" || existing.visit_status === "DONE") {
    throw new Error("Yeh visit already Pharmacy se aage badh chuki hai — prescription dobara submit nahi kar sakte is stage se.");
  }

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
      start_offset_days: r.start_offset_days ?? 0,
      remarks: r.remarks ?? null,
    })),
  );
  if (re) throw re;
  const { error: ve } = await supabase
    .from("visits")
    .update({
      visit_status: "PHARMACY",
      doctor_notes: input.doctor_notes,
      next_visit_date: input.next_visit_date,
      case_discussed_at: new Date().toISOString(),
      rx_draft: null,
    })
    .eq("id", input.visit_id);
  if (ve) throw ve;
  const { error: pe } = await supabase
    .from("patients")
    .update({ last_visit_date: today() })
    .eq("id", input.patient_id);
  if (pe) throw pe;
}

// ---------- Case discussion tracking (Dr. Yadav, 29 Jul 2026) ----------
// The actual problem being solved: online cases pay upfront (₹3700, vs
// ₹1000 for walk-in) and used to be tracked entirely on paper — a case
// could sit for 10-20 days with nobody noticing the doctor never
// reviewed it and the courier never went out. case_discussed_at (set
// atomically the moment Rx is submitted, see submitPrescription above)
// is what makes "still pending" a real, queryable fact instead of
// something staff had to remember to check a notebook for.
export interface PendingCase {
  id: string;
  patient_id: string;
  visit_date: string;
  visit_type: string;
  visit_status: string;
  token_number: string | null;
  branch: string;
  created_at: string;
  patient?: { name: string; mobile: string; patient_code: string | null };
}

// Deliberately NO 30-day floor like fetchTodayQueue has — a case that's
// been stuck for 45 days must still show up here. That's the entire
// point: it should be structurally impossible for one to go missing.
export async function fetchPendingCases(): Promise<PendingCase[]> {
  const { data, error } = await supabase
    .from("visits")
    .select("*, patient:patients(name, mobile, patient_code)")
    .is("case_discussed_at", null)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) return [];
  return (data ?? []) as PendingCase[];
}

export interface CaseFunnelPeriodStats {
  total: number;
  discussed: number;
  online_total: number;
  online_discussed: number;
}
export interface CaseFunnelStats {
  today: CaseFunnelPeriodStats;
  week: CaseFunnelPeriodStats;
  month: CaseFunnelPeriodStats;
  year: CaseFunnelPeriodStats;
}

export async function fetchCaseFunnelStats(): Promise<CaseFunnelStats | null> {
  const { data, error } = await supabase.rpc("case_funnel_stats");
  if (error || !data) return null;
  return data as CaseFunnelStats;
}

// ---------- Degraded-mode alerts (re-audit C-4, 29 Jul 2026) ----------
// Several functions (registration, check-in, dispense, Rx submission,
// patient code, token, stock) fall back to an older, less-safe path if
// their atomic RPC is missing (SQL migration not run yet, or the
// function got dropped/renamed). That fallback is intentional — it
// keeps the clinic running instead of hard-failing — but it used to be
// completely silent. Nobody would know it was happening for months.
// This logs it, fire-and-forget, so Owner Health can surface it.
export async function logDegradedModeAlert(rpcName: string, context?: Record<string, unknown>) {
  try {
    await supabase.from("system_alerts").insert({
      type: "RPC_FALLBACK",
      message: `${rpcName} RPC missing — fell back to the older, less-safe path. Run the matching SQL migration.`,
      context: context ?? null,
    });
  } catch (e: any) {
    // Never let alert-logging itself break the actual operation.
    console.error("logDegradedModeAlert failed:", e?.message ?? e);
  }
}

export interface SystemAlert {
  id: string;
  type: string;
  message: string;
  context: Record<string, unknown> | null;
  created_at: string;
  resolved: boolean;
}

export async function fetchSystemAlerts(): Promise<SystemAlert[]> {
  const { data, error } = await supabase
    .from("system_alerts")
    .select("*")
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []) as SystemAlert[];
}

export async function resolveSystemAlert(id: string) {
  const { error } = await supabase.from("system_alerts").update({ resolved: true }).eq("id", id);
  return { success: !error, error: error?.message ?? null };
}

// Manual override for the staff PIN lockout (audit P1-14). The lockout
// auto-expires after 15 minutes on its own, but a staff member stuck
// mid-shift can't wait that out — Owner needs a way to clear it
// immediately. Gap Dr. Yadav caught (29 Jul 2026): this didn't exist.
export async function unlockStaffLogin(mobile: string) {
  const cleaned = mobile.replace(/\D/g, "");
  const { error } = await supabase.from("login_attempts").delete().eq("mobile", cleaned);
  return { success: !error, error: error?.message ?? null };
}


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
  // 04 Aug 2026: was always "days before due date" (must be positive).
  // Now allows negative values too, meaning "this many days AFTER the
  // due date" — needed for the staged post-due chase sequence (Day 2/5/
  // 9/14/19/25), which fires only once a patient has already missed
  // their date, not before it.
  days_before_due: number;
  // 04 Aug 2026: which channel this touchpoint is for. CALL rows are a
  // manual-worklist-only entry (RECP2 has to actually call); WHATSAPP
  // rows also get an automated message from whatsapp-daily-reminders.
  // Defaults to WHATSAPP so every pre-existing rule (all created before
  // this field existed) keeps behaving exactly as it did.
  channel: "CALL" | "WHATSAPP";
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

export async function saveFollowupTouchpoint(
  input: Partial<FollowupTouchpoint> & { label: string; min_gap_days: number; max_gap_days: number; days_before_due: number; channel: "CALL" | "WHATSAPP" },
) {
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
            due_date: d.toISOString().slice(0, 10),
            followup_type: r.label,
            channel: r.channel ?? "WHATSAPP",
          };
        })
      : [
          {
            due_date: dueTarget.toISOString().slice(0, 10),
            followup_type: "DEFAULT",
            channel: "WHATSAPP" as const,
          },
        ];

  // 04 Aug 2026 fix: this used to be a separate DELETE (error only
  // console.error'd, never thrown) followed by a separate INSERT -- two
  // network round-trips, not one transaction. If the DELETE failed, old
  // PENDING rows stayed AND the fresh set got inserted on top (duplicate
  // reminders). If the two calls raced a concurrent retry for the same
  // visit, both could insert on top of each other the same way. Now one
  // atomic RPC does delete+insert inside a single transaction, with the
  // visit row locked so a concurrent retry serializes instead of racing
  // (supabase/sql-manual/0024_atomic_followup_reschedule.sql). Falls back
  // to the old (racy) two-step approach only until that SQL is run.
  const { error: rpcError } = await supabase.rpc("reschedule_followups_atomic", {
    p_patient_id: patientId,
    p_visit_id: visitId,
    p_rows: rows,
  });
  if (!rpcError) return;

  const isMissingFunction = rpcError?.code === "42883" || /function .* does not exist/i.test(rpcError?.message ?? "");
  if (!isMissingFunction) throw rpcError;
  logDegradedModeAlert("reschedule_followups_atomic", { visit_id: visitId });

  const fallbackRows = rows.map((r) => ({
    patient_id: patientId,
    visit_id: visitId,
    due_date: r.due_date,
    followup_type: r.followup_type,
    channel: r.channel,
    status: "PENDING" as const,
  }));

  const { error: delErr } = await supabase
    .from("followups")
    .delete()
    .eq("visit_id", visitId)
    .eq("status", "PENDING");
  if (delErr) console.error("generateFollowupSchedule fallback: clearing old pending rows failed:", delErr.message);

  const { error } = await supabase.from("followups").insert(fallbackRows);
  if (error) {
    // Must not silently lose follow-up coverage — this used to only
    // console.error and swallow, which meant collectPayment's catch
    // around this call could never actually fire for the most likely
    // failure (the insert itself). Now it throws, so the caller's
    // "payment saved, but follow-up schedule didn't" message is real.
    console.error("generateFollowupSchedule fallback insert failed:", error.message);
    throw error;
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
  const upper = istNow();
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
    const { error } = await supabase.from("interactions").insert({
      lead_id: target.leadId ?? null,
      patient_id: target.patientId ?? null,
      type: "whatsapp",
      summary,
    });
    if (error) console.error("logWhatsAppInteraction failed:", error.message);
  } catch (e: any) {
    console.error("logWhatsAppInteraction threw:", e?.message ?? e);
  }
}

// FIXED 05 Aug: this used to be one enum mixing "temperature" (HOT/Warm/
// Cold) with "funnel stage" (Converted/Lost) — but the live DB has TWO
// separate columns for these (leads.status = funnel stage, leads.lead_quality
// = temperature), each with its own CHECK constraint. Writing "Cold" or
// "HOT" into `status` violated leads_status_check on every single insert.
export const LEAD_STAGES = ["NEW", "CONTACTED", "NURTURING", "APPOINTMENT_FIXED", "CONVERTED", "LOST"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  NEW: "New", CONTACTED: "Contacted", NURTURING: "Nurturing",
  APPOINTMENT_FIXED: "Appointment Fixed", CONVERTED: "Converted", LOST: "Lost",
};

export const LEAD_QUALITIES = ["HOT", "WARM", "COLD"] as const;
export type LeadQuality = (typeof LEAD_QUALITIES)[number];

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
    .or(`name.ilike.${like},mobile.ilike.${like},lead_source.ilike.${like}`)
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
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("lead_quality", "HOT"),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "CONVERTED"),
    supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", istDayStart(today())),
  ]);
  return {
    total: total.count ?? 0,
    hot: hot.count ?? 0,
    converted: converted.count ?? 0,
    newToday: newToday.count ?? 0,
  };
}

// ---------- Lead source tracking (TASK 5, fixed 05 Aug — see migration 0030) ----------
// CRITICAL FIX (05 Aug): these values used to be Title-Case free strings
// ("Walk-in", "JustDial"...) that DON'T match the live `leads_lead_source_check`
// CHECK constraint, which only allows the exact uppercase set below. Every
// insert using the old values was failing silently at the DB layer — this
// is why the live leads table had 0 rows despite a fully-built UI. Values
// here are the DB's canonical vocabulary; LEAD_SOURCE_LABELS is what staff
// actually see on screen.
export const LEAD_SOURCES = [
  "WALK_IN",
  "JUSTDIAL",
  "WHATSAPP",
  "INSTAGRAM",
  "FACEBOOK",
  "GOOGLE",
  "REFERRAL",
  "YOUTUBE",
  "OTHER",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  WALK_IN: "Walk-in",
  JUSTDIAL: "JustDial",
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  GOOGLE: "Google",
  REFERRAL: "Referral",
  YOUTUBE: "YouTube",
  OTHER: "Other",
};

// Per-source capture criteria — what's required/expected when a lead comes
// in from each channel, and how it actually reaches the leads table today.
// Shown in the Add Lead form (conditional fields) and documented here so
// it doesn't live only in one person's head.
export const LEAD_SOURCE_CRITERIA: Record<LeadSource, { capture: "auto" | "manual"; required: string[]; note: string }> = {
  WALK_IN: { capture: "manual", required: ["name", "mobile"], note: "Reception adds on the spot when someone walks in or calls without an online trail." },
  JUSTDIAL: { capture: "auto", required: ["name", "mobile"], note: "Pabbly → Apps Script → justdial-lead-webhook (HMAC-secured). Auto lead_quality=HOT, auto LEAD_WELCOME WhatsApp." },
  WHATSAPP: { capture: "manual", required: ["name", "mobile"], note: "Staff logs when a fresh number messages the clinic WhatsApp. Auto-capture via AiSensy incoming webhook is on the roadmap, not built yet." },
  INSTAGRAM: { capture: "manual", required: ["name", "mobile"], note: "DM/comment enquiry — staff logs manually. Meta Lead Ads webhook not built yet." },
  FACEBOOK: { capture: "manual", required: ["name", "mobile"], note: "Same as Instagram — manual today, Meta webhook is a future upgrade." },
  GOOGLE: { capture: "manual", required: ["name", "mobile"], note: "Search/Maps/Ads enquiry call — manual today, Google Ads lead-form webhook is a future upgrade." },
  REFERRAL: { capture: "manual", required: ["name", "mobile", "referred_by_patient_id"], note: "Must link the referring patient — used for thank-you follow-up and future incentive tracking." },
  YOUTUBE: { capture: "manual", required: ["name", "mobile"], note: "Comment/DM enquiry — manual." },
  OTHER: { capture: "manual", required: ["name", "mobile"], note: "Catch-all — use the Notes field to say what it actually was." },
};

export function normalizeLeadSource(raw: string | null | undefined): LeadSource {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "OTHER";
  if (/walk|opd|clinic/.test(s)) return "WALK_IN";
  if (/refer/.test(s)) return "REFERRAL";
  if (/just ?dial|^jd$/.test(s)) return "JUSTDIAL";
  if (/google|gmb|search|ads?$/.test(s)) return "GOOGLE";
  if (/facebook|fb|meta/.test(s)) return "FACEBOOK";
  if (/insta|ig$/.test(s)) return "INSTAGRAM";
  if (/whats ?app|wa$/.test(s)) return "WHATSAPP";
  if (/you ?tube|yt$/.test(s)) return "YOUTUBE";
  return "OTHER";
}

// ---------- Owner-extensible lead sources (06 Aug, migration 0033) ----------
// The 9 above are the well-known/built-in set (with real per-source
// criteria text). Beyond that, Dr. Yadav asked for an "Add More" option —
// a new ad platform (IndiaMART, Sulekha, whatever comes next) shouldn't
// need a code change. leads.lead_source is now a foreign key into
// public.lead_sources instead of a hardcoded CHECK list, so adding a row
// here IS the whole operation — external-lead-webhook validates against
// this same live table, so a newly-added source works immediately for
// anything already configured to send it.
export interface LeadSourceRow { code: string; label: string; active: boolean }

export async function fetchLeadSources(): Promise<LeadSourceRow[]> {
  const { data, error } = await supabase.from("lead_sources").select("code, label, active").order("label");
  if (error) {
    console.error("fetchLeadSources failed:", error.message);
    // Never let a fetch failure block the Add-Lead form entirely — fall
    // back to the built-in set so staff can still add a lead.
    return LEAD_SOURCES.map((code) => ({ code, label: LEAD_SOURCE_LABELS[code], active: true }));
  }
  return data ?? [];
}

export async function addLeadSource(label: string): Promise<{ success: boolean; error: string | null; code?: string }> {
  const clean = label.trim();
  if (!clean) return { success: false, error: "Naam zaroori hai" };
  // Deterministic code from the label — "IndiaMART" -> "INDIAMART", "Just Dial 2" -> "JUST_DIAL_2".
  const code = clean.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  if (!code) return { success: false, error: "Valid naam do (letters/numbers)" };
  const { error } = await supabase.from("lead_sources").insert({ code, label: clean });
  if (error) {
    if (error.code === "23505") return { success: false, error: "Ye source pehle se hai" };
    return { success: false, error: error.message };
  }
  return { success: true, error: null, code };
}

export async function setLeadSourceActive(code: string, active: boolean) {
  const { error } = await supabase.from("lead_sources").update({ active }).eq("code", code);
  return { success: !error, error: error?.message ?? null };
}

/**
 * Per-source counts, computed with COUNT queries (never from the capped
 * 500-row list) so the numbers stay honest at 30k+ leads.
 *
 * `leads` = enquiries received, `converted` = those that became patients,
 * `patients` = patients whose own lead_source says they came from there
 * (covers walk-ins that never existed as a lead row at all).
 */
export async function fetchLeadSourceStats(): Promise<
  { source: LeadSource; leads: number; converted: number; patients: number }[]
> {
  const results = await Promise.all(
    LEAD_SOURCES.map(async (source) => {
      const [leadsRes, convRes, patRes] = await Promise.all([
        supabase.from("leads").select("id", { count: "exact", head: true }).eq("lead_source", source),
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("lead_source", source)
          .eq("status", "CONVERTED"),
        supabase.from("patients").select("id", { count: "exact", head: true }).eq("lead_source", source),
      ]);
      return {
        source,
        leads: leadsRes.count ?? 0,
        converted: convRes.count ?? 0,
        patients: patRes.count ?? 0,
      };
    }),
  );
  // Busiest source first; hide the sources with literally nothing in them so
  // the reception screen doesn't show eight rows of zeros.
  return results
    .filter((r) => r.leads > 0 || r.patients > 0)
    .sort((a, b) => b.leads + b.patients - (a.leads + a.patients));
}


// Phase 1 #8: fetches LIMIT+1 rows so it can tell whether the real table
// has more than LIMIT rows without a separate count() query. If it does,
// the extra row is dropped and truncated=true is returned so the UI can
// show a warning instead of silently looking "complete" while actually
// missing rows past the cap.
export async function fetchLeads(): Promise<{ rows: any[]; truncated: boolean }> {
  const LIMIT = 500;
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(LIMIT + 1);
  if (error) return { rows: [], truncated: false };
  const rows = data ?? [];
  const truncated = rows.length > LIMIT;
  return { rows: truncated ? rows.slice(0, LIMIT) : rows, truncated };
}
// FIXED 05 Aug: renamed from updateLeadStatus (which wrote temperature
// values like "HOT" into the funnel-stage column). This one only touches
// `status` (leads_status_check: NEW/CONTACTED/NURTURING/APPOINTMENT_FIXED/
// CONVERTED/LOST).
export async function updateLeadStage(id: string, stage: LeadStage) {
  const { error } = await supabase.from("leads").update({ status: stage }).eq("id", id);
  if (error) throw error;
}

// New — separate control for temperature (leads_quality_check: HOT/WARM/COLD),
// which used to be conflated with stage and so had no working way to set it.
export async function setLeadQuality(id: string, quality: LeadQuality) {
  const { error } = await supabase.from("leads").update({ lead_quality: quality }).eq("id", id);
  if (error) throw error;
}

export async function setLeadDnd(id: string, dnd: boolean) {
  const { error } = await supabase.from("leads").update({ dnd }).eq("id", id);
  return { success: !error, error: error?.message ?? null };
}

// New — assignment (leads.assigned_to existed in the DB but was never
// wired to any UI/function before this).
export async function assignLead(id: string, userId: string | null) {
  const { error } = await supabase.from("leads").update({ assigned_to: userId }).eq("id", id);
  return { success: !error, error: error?.message ?? null };
}

// New — follow-up date (leads.next_followup existed but nothing wrote it).
export async function setLeadFollowup(id: string, date: string | null) {
  const { error } = await supabase.from("leads").update({ next_followup: date }).eq("id", id);
  return { success: !error, error: error?.message ?? null };
}

// New — call logging (leads.call_count/last_outcome existed but nothing
// wrote them). Increments the count and records the outcome in one call.
export const LEAD_CALL_OUTCOMES = ["No Answer", "Interested", "Not Interested", "Callback Requested", "Booked"] as const;
export async function logLeadCall(id: string, outcome: (typeof LEAD_CALL_OUTCOMES)[number]) {
  const { data: row } = await supabase.from("leads").select("call_count").eq("id", id).maybeSingle();
  const nextCount = (row?.call_count ?? 0) + 1;
  const { error } = await supabase.from("leads").update({ call_count: nextCount, last_outcome: outcome }).eq("id", id);
  return { success: !error, error: error?.message ?? null };
}

// ---------- Inventory ----------
export async function fetchInventory(): Promise<{ rows: any[]; truncated: boolean }> {
  const LIMIT = 2000;
  const { data, error } = await supabase
    .from("inventory")
    .select("*")
    .order("medicine_name", { ascending: true })
    .limit(LIMIT + 1);
  if (error) return { rows: [], truncated: false };
  const rows = data ?? [];
  const truncated = rows.length > LIMIT;
  return { rows: truncated ? rows.slice(0, LIMIT) : rows, truncated };
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
  // Was read-then-write (select stock_drams, add in JS, write back) —
  // two staff adding stock for the same medicine at the same moment
  // could clobber each other's update (audit finding, re-audit 29 Jul:
  // "lost update" — one entry silently vanishes). Now a row-locked RPC
  // does the read+increment inside one transaction. Falls back to the
  // old racy path only until that SQL is run.
  const { data, error: rpcError } = await supabase.rpc("increment_stock", {
    p_medicine_name: input.medicine_name,
    p_potency: input.potency,
    p_branch: input.branch,
    p_quantity: input.quantity,
    p_type: input.type ?? null,
  });
  if (!rpcError) return { success: true, error: null, id: (data as any)?.id };
  logDegradedModeAlert("increment_stock", { medicine_name: input.medicine_name, branch: input.branch });

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

// ---------- Medicine Master (05 Aug 2026) ----------
// A real name-only catalog, decoupled from stock/potency/branch. Was
// previously just "whatever medicine_name values exist in inventory"
// (fetchMasterMedicines, removed) — that had two live bugs: it selected
// an `inventory.type` column that never existed in the DB (silently
// swallowed error, page always showed empty), and "adding a medicine"
// meant creating a phantom 0-stock inventory row rather than a real
// catalog entry. Migration 0028 fixed both and added this `medicines`
// table, seeded with 180 standard remedies so nobody has to type a name
// from scratch. Owner/Pharmacy can add more or rename/deactivate here;
// inventory (potency + stock + branch) is unchanged and unrelated.
export interface DBMedicine {
  id: string;
  name: string;
  is_active: boolean;
}

/** Bulk version of addStockEntry — one medicine, one branch, several
 * potencies in a single user action (05 Aug 2026, Dr. Yadav's request:
 * with 180+ medicines × several potencies × 2 branches, one-at-a-time
 * entry meant 500+ separate form submissions). Runs the potency rows in
 * parallel (each is already its own row-locked transaction server-side
 * via increment_stock) and reports which ones failed rather than
 * all-or-nothing, so a single bad row doesn't lose the rest of the batch. */
export async function addBulkStockEntries(
  medicine_name: string,
  branch: string,
  entries: { potency: string; quantity: number }[],
): Promise<{ succeeded: number; failed: { potency: string; error: string }[] }> {
  const results = await Promise.allSettled(
    entries.map((e) => addStockEntry({ medicine_name, potency: e.potency, branch, quantity: e.quantity })),
  );
  const failed: { potency: string; error: string }[] = [];
  let succeeded = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.success) succeeded += 1;
    else failed.push({ potency: entries[i].potency, error: r.status === "fulfilled" ? r.value.error ?? "Unknown error" : String(r.reason) });
  });
  return { succeeded, failed };
}

export async function fetchMedicinesCatalog(search?: string, includeInactive = true): Promise<DBMedicine[]> {
  let q = supabase.from("medicines").select("id, name, is_active").eq("is_deleted", false).order("name", { ascending: true }).limit(500);
  if (!includeInactive) q = q.eq("is_active", true);
  const clean = search ? sanitizeIlikeTerm(search) : "";
  const { data, error } = clean ? await q.ilike("name", `%${clean}%`) : await q;
  if (error) return [];
  return (data ?? []) as DBMedicine[];
}

export async function addMedicineToCatalog(name: string): Promise<{ success: boolean; error: string | null; medicine?: DBMedicine }> {
  const clean = name.trim();
  if (!clean) return { success: false, error: "Medicine naam khaali nahi ho sakta" };
  const { data, error } = await supabase.from("medicines").insert({ name: clean }).select("id, name, is_active").maybeSingle();
  if (error) {
    // Unique-violation on the case-insensitive live-name index means it
    // already exists — treat that as success and hand back the existing row,
    // rather than erroring on something the user didn't do wrong.
    if (error.code === "23505") {
      const { data: existing } = await supabase.from("medicines").select("id, name, is_active").ilike("name", clean).eq("is_deleted", false).maybeSingle();
      if (existing) return { success: true, error: null, medicine: existing as DBMedicine };
    }
    return { success: false, error: error.message };
  }
  return { success: true, error: null, medicine: data as DBMedicine };
}

/** Renames a medicine in the master catalog, and cascades the new name onto
 * any current (live) inventory rows still filed under the old name — so
 * branch stock doesn't silently "disappear" under a name nobody can find
 * anymore. Two sequential updates, not one transaction: this is reference
 * data (not money), and at present data volume the risk of a partial
 * failure leaving things briefly inconsistent is low and self-evident
 * (Owner would immediately notice a mismatched name and can re-run it). */
export async function renameMedicineInCatalog(id: string, oldName: string, newName: string): Promise<{ success: boolean; error: string | null }> {
  const clean = newName.trim();
  if (!clean) return { success: false, error: "Naya naam khaali nahi ho sakta" };
  const { error } = await supabase.from("medicines").update({ name: clean, modified_at: new Date().toISOString() }).eq("id", id);
  if (error) return { success: false, error: error.code === "23505" ? "Ye naam pehle se kisi aur medicine ka hai" : error.message };
  if (oldName.trim() !== clean) {
    await supabase.from("inventory").update({ medicine_name: clean, modified_at: new Date().toISOString() }).eq("medicine_name", oldName).eq("is_deleted", false);
  }
  return { success: true, error: null };
}

export async function setMedicineActive(id: string, isActive: boolean): Promise<{ success: boolean; error: string | null }> {
  const { error } = await supabase.from("medicines").update({ is_active: isActive, modified_at: new Date().toISOString() }).eq("id", id);
  return { success: !error, error: error?.message ?? null };
}

/** Per-medicine stock summary across both branches — powers the "Bajaj X ·
 * Jagatpura Y · Total Z" line on the Medicine Master screen. Reuses
 * fetchInventory() (already fetched for the Inventory tab in most sessions)
 * rather than a second round-trip; caller decides whether to pass it in. */
export function summarizeStockByMedicine(inventoryRows: any[]): Map<string, { potencies: Set<string>; byBranch: Record<string, number>; total: number }> {
  const map = new Map<string, { potencies: Set<string>; byBranch: Record<string, number>; total: number }>();
  for (const r of inventoryRows) {
    if (r.is_deleted) continue;
    const cur = map.get(r.medicine_name) ?? { potencies: new Set<string>(), byBranch: {}, total: 0 };
    if (r.potency) cur.potencies.add(r.potency);
    const stock = Number(r.stock_drams ?? 0);
    cur.byBranch[r.branch] = (cur.byBranch[r.branch] ?? 0) + stock;
    cur.total += stock;
    map.set(r.medicine_name, cur);
  }
  return map;
}

/** Doctor-facing Rx picker — unlike fetchInventorySearch (used by Pharmacy's
 * Add Stock autocomplete, which should show zero-stock rows too so staff
 * can find and top them up), this only returns potency/branch combos that
 * actually have stock right now, so a doctor can never select something
 * that isn't physically on the shelf. */
export async function fetchInStockMedicines(term: string, branch?: string) {
  const clean = sanitizeIlikeTerm(term);
  let q = supabase.from("inventory").select("*").eq("is_deleted", false).gt("stock_drams", 0).limit(20);
  if (branch) q = q.eq("branch", branch);
  const { data, error } = clean ? await q.ilike("medicine_name", `%${clean}%`) : await q;
  if (error) return [];
  return data ?? [];
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
  // One atomic RPC (audit P0-5, Dr. Yadav's decision 29 Jul): the status
  // guard + status update + inventory decrement for every prescription
  // line on this visit all happen in one transaction.
  // Decrement is approximate by design (Dr. Yadav's own words: exact
  // drops aren't fixed, staff already eyeballs the physical bottle) —
  // is_slx (SL globules) = 4 drams (a full 45ml bottle), non-SLX
  // (drops/liquid) = 0.5 dram.
  //
  // Block 3: the old two-step fallback was REMOVED. It skipped the
  // inventory decrement entirely, so dispensing kept working while stock
  // silently drifted away from reality — the worst possible failure mode
  // for a pharmacy. Blocking the dispense is the safe choice.
  const { data, error } = await supabase.rpc("dispense_visit_atomic", { p_visit_id: visitId });
  if (!error) return data;

  const isMissingFunction = error?.code === "42883" || /function .* does not exist/i.test(error?.message ?? "");
  if (isMissingFunction) {
    logDegradedModeAlert("dispense_visit_atomic", { visit_id: visitId });
    throw new Error(
      "Dispense abhi possible nahi — database function `dispense_visit_atomic` missing hai. " +
        "Owner ko bolein pending SQL migration run karein (iske bina stock count galat ho jaata).",
    );
  }
  throw error;
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
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
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
// are just identifiers, never directly-usable links. Older rows (pre 04 Aug
// 2026) store the legacy "https://.../object/public/<bucket>/<path>" shape
// from a since-removed getPublicUrl() call; new uploads store the bare path
// directly (uploadCasePhoto / uploadPatientDocument). Either shape works
// here: if the marker isn't found we just treat the whole stored value as
// the path. From whichever shape, we mint a short-lived signed URL each
// time the document actually needs to be shown. Nothing is ever written
// back to the DB from this function; it's read-only resolution.
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
    // Phase 1 #15 — queue this file for the Storage-to-Drive backup sync.
    // Best-effort: a queue-insert hiccup must never fail an upload that
    // already succeeded, so it's fire-and-forget like the other
    // secondary-effect writes in this file (follow-up scheduling, etc).
    supabase.from("storage_backup_queue").insert({ bucket: "case-photos", path }).then(({ error: qErr }) => {
      if (qErr) console.error("storage_backup_queue enqueue failed:", qErr.message);
    });
    // 04 Aug 2026 fix: used to call getPublicUrl() here and store that.
    // Bucket is Private, so that URL never actually worked as a public
    // link — but the shape implied one, which was fragile (a bucket ever
    // flipped to Public would have made it a real, unsigned leak). We
    // just return/store the raw path now; resolveDocUrl() below already
    // knows how to turn a bare path into a short-lived signed URL, and
    // every reader already goes through resolveDocUrl(), never the raw
    // stored value directly.
    return { success: true, error: null, url: path };
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
// Real structure, corrected 10 Aug 2026 per Dr. Yadav (the previous
// two-part card_number+card_register was built on a wrong assumption —
// card_register held a doctor's name, not the real system): a Series
// (one or two letters — A, B, K, AA, AB...), a Register number within
// that series (~100 registers per series), and a Card number within that
// register. Written together as e.g. "B-10-12". card_series is a new
// column; card_register is the same column as before but now holds the
// register NUMBER, not a doctor name; card_number is unchanged.
//
// The same card number can legitimately repeat across different
// series/register combinations, but the exact same (series, register,
// number) triple existing twice is almost always a data-entry mistake —
// scoping the uniqueness check to all three catches that without
// false-flagging genuinely different registers.
export function formatCardNumber(series: string | null | undefined, register: string | null | undefined, number: string | null | undefined): string | null {
  if (!series && !register && !number) return null;
  return [series, register, number].filter(Boolean).join("-");
}

export async function isDuplicateCardNumber(
  cardSeries: string,
  cardRegister: string,
  cardNumber: string,
  excludePatientId?: string,
): Promise<boolean> {
  const series = cardSeries.trim().toUpperCase();
  const reg = cardRegister.trim();
  const num = cardNumber.trim();
  if (!series || !reg || !num) return false;
  let q = supabase
    .from("patients")
    .select("id", { count: "exact", head: true })
    .eq("card_series", series)
    .eq("card_register", reg)
    .eq("card_number", num);
  if (excludePatientId) q = q.neq("id", excludePatientId);
  const { count } = await q;
  return (count ?? 0) > 0;
}

export async function savePatientCardNumber(patientId: string, cardSeries: string, cardRegister: string, cardNumber: string) {
  const { error } = await supabase
    .from("patients")
    .update({
      card_series: cardSeries.trim().toUpperCase() || null,
      card_register: cardRegister.trim() || null,
      card_number: cardNumber.trim() || null,
    })
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
  if (!isDraft) {
    // Guard: a stale case-taking tab submitting after the visit has
    // already reached Pharmacy/Payment/Done must not drag it back to
    // WAITING_DOCTOR — that would re-open a visit the doctor, pharmacy,
    // or reception already moved past. Notes/photos still save either
    // way (harmless), only the status regression is blocked.
    const { data: existing, error: exErr } = await supabase
      .from("visits")
      .select("visit_status")
      .eq("id", visitId)
      .maybeSingle();
    if (exErr) throw exErr;
    if (existing && !["PHARMACY", "PAYMENT", "DONE"].includes(existing.visit_status)) {
      payload.visit_status = "WAITING_DOCTOR";
    } else if (!existing) {
      throw new Error("Visit not found");
    }
    // else: visit already past this stage — notes save, status untouched.
  }
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
      supabase.from("payments").select("id,amount_received,payment_mode,branch").gte("created_at", istDayStart(monthStart)),
      supabase.from("patients").select("id", { count: "exact", head: true }).gte("created_at", istDayStart(t)),
      supabase.from("followups").select("id", { count: "exact", head: true }).eq("status", "PENDING").lte("due_date", t),
    ]);
  const sum = (rows: any[] | null, filt?: (r: any) => boolean) =>
    (rows ?? []).filter((r) => (filt ? filt(r) : true)).reduce((s, r) => s + Number(r.amount_received ?? 0), 0);
  const monthByMode = await fetchModeBreakdown((monthPay.data ?? []).map((r: any) => r.id));
  return {
    todayVisits: (todayVisitsBajaj.count ?? 0) + (todayVisitsJagatpura.count ?? 0),
    todayVisitsBajaj: todayVisitsBajaj.count ?? 0,
    todayVisitsJagatpura: todayVisitsJagatpura.count ?? 0,
    todayRevenue: sum(todayPay.data),
    todayRevenueBajaj: sum(todayPay.data, (r) => r.branch === "BAJAJ_NAGAR"),
    todayRevenueJagatpura: sum(todayPay.data, (r) => r.branch === "JAGATPURA"),
    monthRevenue: sum(monthPay.data),
    // Was fixed monthCash/monthUpi/monthCard/monthOther fields — replaced
    // 10 Aug 2026 with a dynamic per-mode breakdown so a newly-added
    // Owner payment mode shows up here without another code change.
    monthByMode,
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
// Exported so the IST boundary suite can assert on them directly — these
// four decide which calendar day every payment, visit and report row lands
// in, so they are the highest-value thing in this file to have under test.
export function istDayStart(dateStr: string): string {
  return `${dateStr}T00:00:00+05:30`;
}
export function istDayEnd(dateStr: string): string {
  return `${dateStr}T23:59:59.999+05:30`;
}
// For client-side re-bucketing of already-fetched rows by IST calendar
// day (used where we can't push the boundary into the SQL query itself).
export function istDateOf(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return "";
  return new Date(new Date(isoTimestamp).getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Reads the weekday out of an IST calendar-date string safely — parsing
// at UTC noon avoids any boundary edge case near midnight.
export function istWeekday(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

export async function fetchWeekRevenue() {
  const days: { d: string; label: string }[] = [];
  const now = istNow();
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(now);
    dt.setUTCDate(now.getUTCDate() - i);
    const d = dt.toISOString().slice(0, 10);
    days.push({ d, label: labels[istWeekday(d)] });
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

export type ReportPeriod = "today" | "week" | "month" | "lastMonth" | "year" | "custom";

export async function fetchReports(
  period: ReportPeriod,
  branch?: string,
  range?: { from: string; to: string },
) {
  const now = istNow();
  let start: string;
  let end: string | null = null;
  if (period === "custom") {
    // Date-wise access: any explicit IST calendar range (single day too,
    // when from === to). Falls back to today if the caller passes nothing.
    start = range?.from || now.toISOString().slice(0, 10);
    end = range?.to || start;
  } else if (period === "today") {
    start = now.toISOString().slice(0, 10);
    end = start;
  } else if (period === "week") {
    const d = new Date(now); d.setUTCDate(now.getUTCDate() - 6);
    start = d.toISOString().slice(0, 10);
  } else if (period === "month") {
    start = now.toISOString().slice(0, 8) + "01";
  } else if (period === "lastMonth") {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const e = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    start = d.toISOString().slice(0, 10);
    end = e.toISOString().slice(0, 10);
  } else {
    start = now.getUTCFullYear() + "-01-01";
  }

  let payQ = supabase.from("payments").select("id,amount_received,amount_charged,balance_due,payment_mode").gte("created_at", istDayStart(start));
  let visQ = supabase.from("visits").select("id,patient_id").gte("visit_date", start);
  let patQ = supabase.from("patients").select("id", { count: "exact", head: true }).gte("created_at", istDayStart(start));
  let leadQ = supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "CONVERTED").gte("created_at", istDayStart(start));
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
  const totalPatients = new Set((vis.data ?? []).map((v: any) => v.patient_id)).size;
  const newPatients = pat.count ?? 0;
  const avg = totalPatients ? Math.round(totalRev / totalPatients) : 0;
  // Was fixed Cash/UPI/Card rows — 10 Aug 2026, replaced with one row per
  // active payment mode (plus any deactivated mode with real history in
  // this period) so a new Owner-added mode shows up here automatically.
  const byMode = await fetchModeBreakdown(rows.map((r: any) => r.id));
  const modeRows: [string, string][] = byMode.map((m) => [`${m.label} Collection`, `₹${m.amount.toLocaleString("en-IN")}`]);
  return {
    rows: [
      ["Total Revenue", `₹${totalRev.toLocaleString("en-IN")}`],
      ["Total Patients", String(totalPatients)],
      ["New Patients", String(newPatients)],
      ["Avg per Patient", `₹${avg.toLocaleString("en-IN")}`],
      ...modeRows,
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
  appointment_type?: ApptType;
  doctor?: string;
  reason?: string;
  branch?: string;
  patient_id?: string;
}

export async function fetchAppointments(date?: string): Promise<{ rows: any[]; truncated: boolean }> {
  // Re-audit finding: ascending order + limit(500) with no date meant
  // that once the table crossed 500 total rows, the oldest appointments
  // would always win the limit and new ones would never appear. The one
  // live call site always passes a date so this wasn't actively biting,
  // but the function itself wasn't safe by construction — a future
  // caller that forgot to pass date would hit it silently. Now floors
  // to today() whenever no specific date is given, so "no date" means
  // "upcoming", never "the oldest 500 ever created".
  const LIMIT = 500;
  let q = supabase.from("appointments").select("*").order("appointment_time", { ascending: true }).limit(LIMIT + 1);
  if (date) q = q.eq("appointment_date", date);
  else q = q.gte("appointment_date", today());
  const { data, error } = await q;
  if (error) return { rows: [], truncated: false };
  const rows = data ?? [];
  const truncated = rows.length > LIMIT;
  return { rows: truncated ? rows.slice(0, LIMIT) : rows, truncated };
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

// New Case vs Follow-up (10 Aug 2026, Dr. Yadav's decision): new cases run
// 30-60 min and are handled by Junior Doctors, follow-ups are much shorter.
// Each type gets its own slot duration and an optional daily cap per
// branch, so reception can book either quickly without the two competing
// for the same undifferentiated slot grid. Deliberately NOT tied to a
// specific Junior Doctor yet — that's a time-block only for now, doctor
// assignment can be added later without reshaping this.
export type ApptType = "NEW" | "FOLLOWUP";
export const APPT_TYPES: ApptType[] = ["NEW", "FOLLOWUP"];
export const apptTypeLabel = (t: ApptType) => (t === "NEW" ? "New Case" : "Follow-up");

export interface TypeSlotConfig {
  slotMinutes: number;
  // null/undefined = unlimited. Simple daily total per branch, not a
  // per-hour or per-doctor cap — Owner can tighten this later if needed.
  dailyCap: Record<ApptBranch, number | null>;
}

export interface SlotConfig {
  /** @deprecated kept only so old saved settings still parse; superseded by typeConfig[type].slotMinutes */
  slotMinutes: number;
  capacityPerSlot: number;
  hours: Record<ApptBranch, { start: string; end: string }>;
  typeConfig: Record<ApptType, TypeSlotConfig>;
}

export const DEFAULT_SLOT_CONFIG: SlotConfig = {
  slotMinutes: 15,
  capacityPerSlot: 2,
  hours: {
    "BAJAJ_NAGAR": { start: "09:00", end: "20:00" },
    "JAGATPURA": { start: "09:00", end: "20:00" },
  },
  typeConfig: {
    NEW: {
      slotMinutes: 45,
      dailyCap: { BAJAJ_NAGAR: null, JAGATPURA: null },
    },
    FOLLOWUP: {
      slotMinutes: 15,
      dailyCap: { BAJAJ_NAGAR: null, JAGATPURA: null },
    },
  },
};

export async function fetchSlotConfig(): Promise<SlotConfig> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "appointment_slot_config").maybeSingle();
  if (error) console.error("fetchSlotConfig failed:", error.message);
  if (!data?.value) return DEFAULT_SLOT_CONFIG;
  try {
    const parsed = JSON.parse(data.value);
    return {
      slotMinutes: parsed.slotMinutes ?? DEFAULT_SLOT_CONFIG.slotMinutes,
      capacityPerSlot: parsed.capacityPerSlot ?? DEFAULT_SLOT_CONFIG.capacityPerSlot,
      hours: { ...DEFAULT_SLOT_CONFIG.hours, ...(parsed.hours ?? {}) },
      // Settings saved before 10 Aug 2026 won't have typeConfig at all —
      // fall back to defaults per type rather than crashing on a missing key.
      typeConfig: {
        NEW: { ...DEFAULT_SLOT_CONFIG.typeConfig.NEW, ...(parsed.typeConfig?.NEW ?? {}) },
        FOLLOWUP: { ...DEFAULT_SLOT_CONFIG.typeConfig.FOLLOWUP, ...(parsed.typeConfig?.FOLLOWUP ?? {}) },
      },
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
  const { data, error } = await supabase.from("settings").select("value").eq("key", "vip_reserved_slots").maybeSingle();
  if (error) console.error("fetchVipSlots failed:", error.message);
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

export interface SlotInfo { time: string; booked: number; capacity: number; vip: boolean; vipNote?: string; full: boolean; capReached: boolean }

// Combines slot config + today's actual bookings + any VIP holds for this
// exact date/branch/type into one list the New Appointment picker can
// render directly. `type` picks which duration generates the slot grid
// (New Case slots are longer, so there are fewer of them across the same
// operating hours) and whether the type's daily cap has already been hit —
// once hit, every slot for that type/date/branch shows full, on top of the
// existing per-slot capacity check.
export async function fetchSlotAvailability(date: string, branch: ApptBranch, type: ApptType = "FOLLOWUP"): Promise<SlotInfo[]> {
  const [cfg, vip, appts] = await Promise.all([
    fetchSlotConfig(),
    fetchVipSlots(),
    fetchAppointments(date),
  ]);
  const hours = cfg.hours[branch] ?? DEFAULT_SLOT_CONFIG.hours[branch];
  const typeCfg = cfg.typeConfig[type] ?? DEFAULT_SLOT_CONFIG.typeConfig[type];
  const times = generateSlots(hours.start, hours.end, typeCfg.slotMinutes);
  const activeAppts = appts.rows.filter((a) => a.branch === branch && a.status !== "Cancelled");
  const activeOfType = activeAppts.filter((a) => (a.appointment_type ?? "FOLLOWUP") === type);
  const dailyCap = typeCfg.dailyCap[branch];
  const capReached = dailyCap != null && activeOfType.length >= dailyCap;
  const vipForThis = vip.filter((v) => v.date === date && v.branch === branch);
  return times.map((t) => {
    const booked = activeOfType.filter((a) => (a.appointment_time ?? "").slice(0, 5) === t).length;
    const vipMatch = vipForThis.find((v) => v.time === t);
    return {
      time: t,
      booked,
      capacity: cfg.capacityPerSlot,
      vip: !!vipMatch,
      vipNote: vipMatch?.note,
      full: capReached || booked >= cfg.capacityPerSlot,
      capReached,
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
    .eq("is_deleted", false)
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

export interface UpdateStaffInput {
  id: string;
  name: string;
  mobile: string;
  role: string;
  branch: string | null;
}

// Profile-field edit only (name/mobile/role/branch) — does not touch login
// email or PIN, that stays on the create-staff-login Edge Function path
// (EditEmailModal in owner.staff.tsx) since changing a login email needs
// the service-role key.
export async function updateStaffProfile(input: UpdateStaffInput) {
  const { error } = await supabase
    .from("users")
    .update({ name: input.name, mobile: input.mobile, role: input.role, branch: input.branch })
    .eq("id", input.id);
  return { success: !error, error: error?.message ?? null };
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
// Phase 1 #9: settings is a small, bounded config table (roughly 50 fixed
// keys total across the whole app -- case_dr_levels, incentive_splits,
// backup_doctor_config, appointment_slot_config, recp_perm:<role>:<screen>
// for each role/screen combo, etc). Unlike the transactional tables
// elsewhere (leads/patients/visits), it does NOT grow per-patient or
// per-visit, so there's no realistic path to it ever approaching 1000
// rows. The old .limit(1000) was already ~20x headroom over any real
// count -- removed rather than bumped further, since an arbitrary cap on
// a table that structurally can't grow large serves no purpose.
export async function fetchSettings() {
  const { data } = await supabase.from("settings").select("*");
  return data ?? [];
}

/** Manual incentive split: { [userId]: percentageWeight }. Stored as one JSON blob in settings. */
export async function fetchIncentiveSplits(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "incentive_splits").maybeSingle();
  if (error) console.error("fetchIncentiveSplits failed:", error.message);
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

export interface IncentiveConfig { baseline: number; poolPercent: number }
const DEFAULT_INCENTIVE_CONFIG: IncentiveConfig = { baseline: 100000, poolPercent: 4 };

// Was hardcoded (baseline=100000, pool=4%) directly in owner.incentives.tsx
// — Owner couldn't change either without a code redeploy. Defaults here
// match those exact old hardcoded values, so nothing changes for anyone
// until the Owner actually edits it.
export async function fetchIncentiveConfig(): Promise<IncentiveConfig> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "incentive_config").maybeSingle();
  if (error) console.error("fetchIncentiveConfig failed:", error.message);
  if (!data?.value) return DEFAULT_INCENTIVE_CONFIG;
  try {
    const parsed = JSON.parse(data.value);
    return {
      baseline: Number(parsed.baseline) || DEFAULT_INCENTIVE_CONFIG.baseline,
      poolPercent: Number(parsed.poolPercent) || DEFAULT_INCENTIVE_CONFIG.poolPercent,
    };
  } catch {
    return DEFAULT_INCENTIVE_CONFIG;
  }
}

export async function saveIncentiveConfig(cfg: IncentiveConfig) {
  await upsertSetting("incentive_config", JSON.stringify(cfg));
}

// Atomic single-statement upsert (migration 0018 adds the UNIQUE constraint
// on settings.key that makes onConflict work). Previously this was a
// check-then-write: two concurrent calls for the SAME key (Owner saving
// Control Centre from two tabs) could both see "no existing row" and both
// INSERT, leaving two rows with the same key -- after which every
// .maybeSingle() reader in this file (fetchIncentiveSplits,
// fetchCaseDrLevels, ...) would start throwing outright.
//
// If 0018 hasn't been run yet, Postgres answers 42P10 ("no unique or
// exclusion constraint matching the ON CONFLICT specification") and we fall
// back to the old two-step path, same not-hard-fail pattern used for the
// atomic RPCs elsewhere -- saving settings must never break just because a
// migration is pending.
export async function upsertSetting(key: string, value: string) {
  const { error } = await supabase.from("settings").upsert({ key, value }, { onConflict: "key" });
  if (!error) return;

  const noConstraint = error.code === "42P10" || /no unique or exclusion constraint/i.test(error.message ?? "");
  if (!noConstraint) throw error;
  logDegradedModeAlert("settings_key_unique", { key });

  const { data, error: selErr } = await supabase.from("settings").select("id").eq("key", key).maybeSingle();
  if (selErr) console.error(`upsertSetting(${key}) existence check failed:`, selErr.message);
  const { error: writeErr } = data?.id
    ? await supabase.from("settings").update({ value }).eq("id", data.id)
    : await supabase.from("settings").insert({ key, value });
  if (writeErr) throw writeErr;
}

// ---------- Fee Master (TASK 4) ----------
// Consultation fees live in the settings table so the Owner can change them
// without a deploy, but they ALWAYS have a hard-coded default so the Payment
// screen can prefill even if settings hasn't been touched yet / fails to load.
export type FeeMaster = { NEW: number; FOLLOWUP: number; ONLINE: number };

export const DEFAULT_FEE_MASTER: FeeMaster = { NEW: 3500, FOLLOWUP: 2500, ONLINE: 3700 };

export const FEE_LABELS: Record<keyof FeeMaster, string> = {
  NEW: "New case",
  FOLLOWUP: "Follow-up",
  ONLINE: "Online case",
};

export async function fetchFeeMaster(): Promise<FeeMaster> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "fee_master").maybeSingle();
  if (error) console.error("fetchFeeMaster failed:", error.message);
  if (!data?.value) return { ...DEFAULT_FEE_MASTER };
  try {
    const parsed = JSON.parse(data.value) as Partial<FeeMaster>;
    // Merge over defaults so a partially-saved blob can never yield ₹0/NaN.
    return {
      NEW: Number(parsed.NEW) > 0 ? Number(parsed.NEW) : DEFAULT_FEE_MASTER.NEW,
      FOLLOWUP: Number(parsed.FOLLOWUP) > 0 ? Number(parsed.FOLLOWUP) : DEFAULT_FEE_MASTER.FOLLOWUP,
      ONLINE: Number(parsed.ONLINE) > 0 ? Number(parsed.ONLINE) : DEFAULT_FEE_MASTER.ONLINE,
    };
  } catch {
    return { ...DEFAULT_FEE_MASTER };
  }
}

export async function saveFeeMaster(fees: FeeMaster) {
  await upsertSetting("fee_master", JSON.stringify(fees));
}

/**
 * Which fee bucket a visit falls into.
 * ONLINE wins over everything (it's a different service, priced separately),
 * otherwise the patient's very first visit is a new case and the rest are
 * follow-ups. lifetime_visits is set to 1 at registration and bumped on each
 * check-in, so <= 1 means "this is their first".
 */
export function feeKindForVisit(visit: { visit_type?: string | null; patient?: { lifetime_visits?: number | null } | null }): keyof FeeMaster {
  // FIXED 06 Aug: was checking for "ONLINE", but visits.visit_type can
  // only ever be OPD/FOLLOWUP/VIDEO/DELIVERY (visits_visit_type_check) —
  // it was never actually "ONLINE" in the DB, so this always fell through
  // to NEW/FOLLOWUP and every video consultation got billed the wrong fee.
  // "ONLINE" stays the FeeMaster/FeeRuleAppliesTo key name (that's just
  // this app's own naming for the fee bucket) — only the DB-value check changes.
  if ((visit.visit_type ?? "").toUpperCase() === "VIDEO") return "ONLINE";
  return Number(visit.patient?.lifetime_visits ?? 1) <= 1 ? "NEW" : "FOLLOWUP";
}

// ---------- Extra Fee Rules (owner-managed, add/remove) ----------
// Request (03 Aug 2026): Fee Master above only has 3 fixed amounts, no way
// to see/edit the re-case surcharge (it was a hidden hard-coded constant)
// or add a genuinely new rule. This is the dynamic list that fixes both --
// stored as a JSON array in settings (same pattern as incentive_splits
// below: an open list, not a fixed-shape object), each rule has a
// dropdown "applies to" (which of the 3 base fee kinds it stacks on top
// of, or ALL) instead of free-text, so the Payment screen can still apply
// it automatically instead of it being a label with no behaviour behind
// it. Amount can be negative -- a discount rule, not just a surcharge.
export type FeeRuleAppliesTo = "NEW" | "FOLLOWUP" | "ONLINE" | "ALL";

export interface FeeRule {
  id: string;
  // "RECASE" is special: it only actually applies when
  // needsRecaseSurcharge() (the 1-year-gap check) is also true, in
  // addition to matching appliesTo -- see the filter in pay.$id.tsx.
  // "CUSTOM" rules apply purely based on appliesTo, no extra condition.
  key: "RECASE" | "CUSTOM";
  label: string;
  amount: number;
  appliesTo: FeeRuleAppliesTo;
}

// Seeded on first load (nothing saved yet) so the re-case surcharge that
// already existed as a hard-coded constant (RECASE_SURCHARGE, still
// defined below as the historical value this seed matches) shows up
// pre-populated here instead of the list just starting empty and
// silently losing it.
export const DEFAULT_FEE_RULES: FeeRule[] = [
  { id: "recase-default", key: "RECASE", label: "Re-case Surcharge (1 saal se follow-up nahi)", amount: 1000, appliesTo: "FOLLOWUP" },
];

export async function fetchFeeRules(): Promise<FeeRule[]> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "fee_rules").maybeSingle();
  if (error) console.error("fetchFeeRules failed:", error.message);
  if (!data?.value) return [...DEFAULT_FEE_RULES];
  try {
    const parsed = JSON.parse(data.value);
    if (!Array.isArray(parsed)) return [...DEFAULT_FEE_RULES];
    return parsed;
  } catch {
    return [...DEFAULT_FEE_RULES];
  }
}

export async function saveFeeRules(rules: FeeRule[]) {
  await upsertSetting("fee_rules", JSON.stringify(rules));
}

/** Sum of every extra rule that's actually active for this visit right now. */
export function activeFeeRulesTotal(
  rules: FeeRule[],
  feeKind: keyof FeeMaster,
  recaseApplies: boolean,
): { total: number; applied: FeeRule[] } {
  const applied = rules.filter((r) => {
    if (r.appliesTo !== "ALL" && r.appliesTo !== feeKind) return false;
    if (r.key === "RECASE" && !recaseApplies) return false;
    return true;
  });
  return { total: applied.reduce((sum, r) => sum + (Number(r.amount) || 0), 0), applied };
}

// ---------- Next Visit Options (Rx improvements item F, 03 Aug 2026) ----------
// Was 3 hardcoded quick-buttons (30/60/90 days) baked into the Rx screen.
// Same open-list-in-settings pattern as fee_rules above -- Owner can
// add/remove/reorder without a redeploy. Always has a hard-coded default
// so the Rx screen still works even if settings hasn't been touched.
export interface NextVisitOption {
  id: string;
  label: string;
  days: number;
}

export const DEFAULT_NEXT_VISIT_OPTIONS: NextVisitOption[] = [
  { id: "nv-1w", label: "1 Week", days: 7 },
  { id: "nv-2w", label: "2 Weeks", days: 14 },
  { id: "nv-1m", label: "1 Month", days: 30 },
  { id: "nv-6w", label: "6 Weeks", days: 45 },
  { id: "nv-2m", label: "2 Months", days: 60 },
  { id: "nv-3m", label: "3 Months", days: 90 },
  { id: "nv-6m", label: "6 Months", days: 180 },
];

export async function fetchNextVisitOptions(): Promise<NextVisitOption[]> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "next_visit_options").maybeSingle();
  if (error) console.error("fetchNextVisitOptions failed:", error.message);
  if (!data?.value) return [...DEFAULT_NEXT_VISIT_OPTIONS];
  try {
    const parsed = JSON.parse(data.value);
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_NEXT_VISIT_OPTIONS];
    return parsed;
  } catch {
    return [...DEFAULT_NEXT_VISIT_OPTIONS];
  }
}

export async function saveNextVisitOptions(options: NextVisitOption[]) {
  await upsertSetting("next_visit_options", JSON.stringify(options));
}

// ---------- SLX Instructions (Rx improvements item E, 03 Aug 2026) ----------
// The "lene ka tarika" (how-to-take) text for SLX/placebo globules --
// previously hardcoded into the PDF ("+ Placebo (SLX) globules as
// instructed") with no screen to change it. One plain-text settings key,
// same upsertSetting() plumbing as everywhere else.
export const DEFAULT_SLX_INSTRUCTIONS =
  "SLX subah-shaam khana khane ke 30 minute baad lein, asal dawai se alag time par.";

export async function fetchSlxInstructions(): Promise<string> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "slx_instructions").maybeSingle();
  if (error) console.error("fetchSlxInstructions failed:", error.message);
  return data?.value?.trim() ? data.value : DEFAULT_SLX_INSTRUCTIONS;
}

export async function saveSlxInstructions(text: string) {
  await upsertSetting("slx_instructions", text);
}

// ---------- Case-Taking Reference Performa (04 Aug 2026, Manual Part 4B) ----------
// Was a hardcoded array of 5 rubric/remedy pairs baked directly into
// doctor.case.reference.tsx -- Owner (a homeopath himself) had no way to
// add or correct entries without a code change. Same open-list-in-
// settings pattern as next_visit_options/fee_rules above.
export interface ReferenceRubric {
  id: string;
  rubric: string;
  remedies: string;
}

export const DEFAULT_REFERENCE_RUBRICS: ReferenceRubric[] = [
  { id: "rr-1", rubric: "Anxiety, health about", remedies: "Ars, Phos, Calc, Nit-ac" },
  { id: "rr-2", rubric: "Fear, dark", remedies: "Stram, Phos, Puls, Calc" },
  { id: "rr-3", rubric: "Irritability", remedies: "Nux-v, Cham, Bry, Staph" },
  { id: "rr-4", rubric: "Weeping, consolation agg", remedies: "Nat-m, Sil, Ign" },
  { id: "rr-5", rubric: "Chilly patient", remedies: "Sil, Calc, Ars, Nux-v" },
];

export async function fetchReferenceRubrics(): Promise<ReferenceRubric[]> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "reference_rubrics").maybeSingle();
  if (error) console.error("fetchReferenceRubrics failed:", error.message);
  if (!data?.value) return [...DEFAULT_REFERENCE_RUBRICS];
  try {
    const parsed = JSON.parse(data.value);
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_REFERENCE_RUBRICS];
    return parsed;
  } catch {
    return [...DEFAULT_REFERENCE_RUBRICS];
  }
}

export async function saveReferenceRubrics(rubrics: ReferenceRubric[]) {
  await upsertSetting("reference_rubrics", JSON.stringify(rubrics));
}


// Phase 3 decision: "Re-case-taking = ₹1000 extra, only if the patient
// hasn't had a single follow-up in the last 1 year."
//
// Deliberately NOT using patient.last_visit_date for the gap check: by the
// time a visit reaches the Payment screen, submitPrescription() has already
// stamped last_visit_date = today() for THIS SAME visit (see above), so the
// gap would always read as zero. What we actually need is the date of the
// visit BEFORE this one, which means asking the visits table directly.
export const RECASE_SURCHARGE = 1000;
const RECASE_GAP_DAYS = 365;

export async function fetchPreviousVisitDate(patientId: string, excludeVisitId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("visits")
    .select("visit_date")
    .eq("patient_id", patientId)
    .neq("id", excludeVisitId)
    .order("visit_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("fetchPreviousVisitDate failed:", error.message);
    return null;
  }
  return data?.visit_date ?? null;
}

/**
 * lifetimeVisits <= 1 means there's no prior visit at all — that's a NEW
 * case, not a "re"-case, so no surcharge regardless of dates. A missing
 * previousVisitDate (data gap) also means "don't guess" — no surcharge.
 */
export function needsRecaseSurcharge(lifetimeVisits: number | null | undefined, previousVisitDate: string | null): boolean {
  if (Number(lifetimeVisits ?? 0) <= 1) return false;
  if (!previousVisitDate) return false;
  const daysSince = (Date.now() - new Date(previousVisitDate).getTime()) / 86_400_000;
  return daysSince > RECASE_GAP_DAYS;
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
  const { data, error } = await supabase.from("settings").select("value").eq("key", "import_batches").maybeSingle();
  if (error) console.error("recordImportBatch: read of existing batch list failed:", error.message);
  let list: any[] = [];
  try { list = data?.value ? JSON.parse(data.value) : []; } catch { list = []; }
  list.unshift({ ...entry, date: new Date().toISOString() });
  await upsertSetting("import_batches", JSON.stringify(list.slice(0, 30)));
}

export async function fetchImportBatches(): Promise<
  { batchId: string; type: string; count: number; date: string }[]
> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "import_batches").maybeSingle();
  if (error) console.error("fetchImportBatches failed:", error.message);
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

// Phase 1 #12 — manual single-lead entry. "Bulk Import" already exists for
// CSV files, but there was no way to add ONE lead by hand (e.g. a walk-in
// enquiry, or a call that doesn't fit the JustDial/import path). Reuses
// the exact same normalization + dedup rules as bulk import so a manually
// typed lead can't create a duplicate against either an existing lead or
// an already-registered patient.
//
// FIXED 05 Aug: was writing lead_source="Manual" and status="Cold" — neither
// value is in the live CHECK constraints (leads_lead_source_check,
// leads_status_check), so this insert has been failing on every single
// call. Now writes the DB's real vocabulary, and also carries the "top
// level" criteria fields per source (see LEAD_SOURCE_CRITERIA): disease
// interest, who referred them (required for REFERRAL), who it's assigned
// to, and which branch it belongs to.
export async function createLead(input: {
  name: string;
  mobile: string;
  source?: string; // built-in LeadSource OR any Owner-added lead_sources.code (migration 0033)
  note?: string;
  diseaseInterest?: string;
  referredByPatientId?: string;
  assignedTo?: string;
  branch?: string;
}): Promise<{ success: boolean; error: string | null }> {
  const name = input.name.trim();
  const mobile = normalizeMobile(input.mobile);
  const source = input.source ?? "OTHER";
  if (!name) return { success: false, error: "Naam zaroori hai" };
  if (mobile.length !== 10) return { success: false, error: "10-digit mobile zaroori hai" };
  if (source === "REFERRAL" && !input.referredByPatientId) {
    return { success: false, error: "Referral ke liye 'Referred By' patient select karna zaroori hai" };
  }

  const [existingLeads, existingPatients] = await Promise.all([
    findExistingMobiles("leads", [mobile]),
    findExistingMobiles("patients", [mobile]),
  ]);
  if (existingLeads.has(mobile)) return { success: false, error: "Yeh mobile already lead list mein hai" };
  if (existingPatients.has(mobile)) return { success: false, error: "Yeh mobile already registered patient hai" };

  const { error } = await supabase.from("leads").insert({
    name,
    mobile,
    lead_source: source,
    status: "NEW",
    lead_quality: source === "JUSTDIAL" ? "HOT" : "WARM",
    notes: input.note?.trim() || null,
    disease_interest: input.diseaseInterest?.trim() || null,
    referred_by_patient_id: input.referredByPatientId || null,
    assigned_to: input.assignedTo || null,
    branch: input.branch || undefined, // omit → DB default (BAJAJ_NAGAR)
  });
  if (error) return { success: false, error: error.message };
  return { success: true, error: null };
}

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
      const chunk = rows.slice(i, i + BATCH).map((r) => {
        const source = normalizeLeadSource(r.source);
        return {
          name: r.name.trim(),
          mobile: r.mobile,
          lead_source: source, // FIXED 05 Aug: free-text/"Bulk Import" isn't in leads_lead_source_check — must be normalized
          status: "NEW",
          lead_quality: source === "JUSTDIAL" ? "HOT" : "WARM",
          notes: r.note?.trim() || null,
          imported_batch: batchId,
        };
      });
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

// Parses "B-01-01" (Series-Register-Number, per Dr. Yadav's real card
// format, 10 Aug 2026) into its three parts. Tolerant of 1-2 letter series
// (A, B, K, AA, AB) and any digit count, since real historical sheets
// won't always be perfectly zero-padded.
export function parseCardNumber(raw: string | undefined): { series: string; register: string; number: string } | null {
  const m = (raw ?? "").trim().toUpperCase().match(/^([A-Z]{1,2})-(\d+)-(\d+)$/);
  if (!m) return null;
  return { series: m[1], register: m[2], number: m[3] };
}

// ----- Patients -----
export interface ImportPatientRow {
  name: string; mobile: string; age?: string; gender?: string; city?: string;
  primary_disease?: string; branch?: string;
  // Added 10 Aug 2026 to match Dr. Yadav's real master-sheet columns.
  address?: string; card_no?: string; referred_by?: string; email?: string;
  category?: string; patient_type?: string; patient_status?: string;
  foreign_patient_info?: string;
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
  // Reserve all codes for this batch up front from the atomic sequence
  // (audit P0-3 remainder) instead of guessing sequential numbers from a
  // single count() read, which could collide with a live registration
  // happening on the floor at the same time as an owner-run import.
  let codes: string[];
  const { data: reserved, error: seqErr } = await supabase.rpc("next_patient_codes", { p_count: rows.length });
  if (!seqErr && Array.isArray(reserved) && reserved.length === rows.length) {
    codes = reserved as string[];
  } else {
    const { count } = await supabase.from("patients").select("id", { count: "exact", head: true });
    let seq = 1000 + (count ?? 0) + 1;
    codes = rows.map(() => `YHC-${seq++}`);
  }

  const BATCH = 500; // bumped for 30k+ scale imports — fewer round trips
  let imported = 0;
  try {
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map((r, j) => {
        const card = parseCardNumber(r.card_no);
        return {
          patient_code: codes[i + j],
          name: r.name.trim(),
          mobile: r.mobile,
          age: r.age ? Number(r.age) || null : null,
          gender: r.gender?.trim() || null,
          city: r.city?.trim() || null,
          address: r.address?.trim() || null,
          primary_disease: r.primary_disease?.trim() || null,
          card_series: card?.series ?? null,
          card_register: card?.register ?? null,
          card_number: card?.number ?? null,
          referred_by: r.referred_by?.trim() || null,
          email: r.email?.trim() || null,
          category: r.category?.trim() || null,
          patient_type: r.patient_type?.trim() || null,
          patient_status: r.patient_status?.trim() || null,
          foreign_patient_info: r.foreign_patient_info?.trim() || null,
          wa_consent: false, // legacy records — no fresh consent captured, deliberately safe default
          branch: r.branch,
          lifetime_visits: 0,
          lifetime_revenue: 0,
          current_balance: 0,
          imported_batch: batchId,
        };
      });
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
  // Added 10 Aug 2026 to match Dr. Yadav's real daily-entry sheet columns.
  branch?: string; // "CLINIC" column — per-row override, falls back to the matched patient's branch
  medicine?: string; duration?: string; slip_no?: string; due_date?: string;
  details?: string; reminder_call?: string;
}

// Folds the historical-record-only columns (medicine/duration/slip no./
// due date/details/reminder call) into one readable note, instead of five
// narrow structured columns nothing else in the app reads. due_date is
// deliberately included here as plain text ONLY — never written to
// visits.next_visit_date, which feeds the live WhatsApp follow-up
// reminder engine. Writing a years-old due date there would fire a real
// reminder to a real patient for a follow-up that's long since resolved.
function buildVisitImportNotes(r: ImportVisitRow): string | null {
  const parts: string[] = [];
  if (r.medicine?.trim()) parts.push(`Medicine: ${r.medicine.trim()}`);
  if (r.duration?.trim()) parts.push(`Duration: ${r.duration.trim()}`);
  if (r.slip_no?.trim()) parts.push(`Slip No.: ${r.slip_no.trim()}`);
  if (r.due_date?.trim()) parts.push(`Due Date (historical, informational only): ${r.due_date.trim()}`);
  if (r.details?.trim()) parts.push(`Details: ${r.details.trim()}`);
  if (r.reminder_call?.trim()) parts.push(`Reminder Call: ${r.reminder_call.trim()}`);
  return parts.length ? parts.join(" | ") : null;
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
    // "CLINIC" column — per-row branch override (e.g. a patient normally at
    // one branch who was seen at the other for one visit); falls back to
    // the matched patient's own branch when blank or not a real branch key.
    const rowBranch = r.branch?.trim().toUpperCase().replace(/\s+/g, "_");
    const branch = rowBranch === "BAJAJ_NAGAR" || rowBranch === "JAGATPURA" ? rowBranch : p.branch;
    valid.push({ ...r, mobile, patient_id: p.id, branch });
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
      import_notes: buildVisitImportNotes(r),
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
      const { data: insertedPays, error: pe } = await supabase.from("payments").insert(paymentInserts).select("id,payment_mode,amount_received");
      if (pe) throw new Error(`${visitsImported} visits already imported, but a payments batch failed: ${pe.message}`);
      paymentsImported += paymentInserts.length;
      // Every payment needs a payment_splits row (single-mode here, since
      // the daily-entry sheet only has one "mode of payment" column per
      // row) — otherwise imported history would show ₹0 in the per-mode
      // breakdown on Owner Reports/Day Summary despite counting toward the
      // total, since those now read from payment_splits, not
      // payments.payment_mode directly.
      const splitInserts = (insertedPays ?? [])
        .filter((p: any) => Number(p.amount_received) > 0)
        .map((p: any) => ({ payment_id: p.id, mode: p.payment_mode, amount: p.amount_received }));
      if (splitInserts.length) {
        const { error: se } = await supabase.from("payment_splits").insert(splitInserts);
        if (se) console.error("payment_splits backfill for imported payments failed:", se.message);
      }
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
    .or(`name.ilike.${like},mobile.ilike.${like},patient_code.ilike.${like},card_number.ilike.${like},card_series.ilike.${like},card_register.ilike.${like}`)
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
export interface ReferralGroup {
  family_group_id: string;
  referrer_name: string;
  referrer_patient_code: string | null;
  member_count: number; // total patients in the group, including the referrer
}

// Phase 1 #13 — family_group_id/family_relationship has existed since the
// family-linking feature was built, but nothing ever reported on it. This
// turns it into a ranked leaderboard: which family "anchor" has brought in
// the most linked family members. Anchor = whoever is marked "Head" in
// the group, falling back to the earliest-registered member. Groups with
// only 1 member (family_group_id set but nobody else ever linked) aren't
// a referral yet, so they're excluded.
export async function fetchReferralLeaderboard(): Promise<ReferralGroup[]> {
  const { data, error } = await supabase
    .from("patients")
    .select("id, name, patient_code, family_group_id, family_relationship, created_at")
    .not("family_group_id", "is", null)
    .order("created_at", { ascending: true });
  if (error) return [];

  const groups = new Map<string, { name: string; patient_code: string | null; family_relationship: string | null }[]>();
  (data ?? []).forEach((p: any) => {
    const arr = groups.get(p.family_group_id) ?? [];
    arr.push({ name: p.name, patient_code: p.patient_code, family_relationship: p.family_relationship });
    groups.set(p.family_group_id, arr);
  });

  const leaderboard: ReferralGroup[] = [];
  groups.forEach((members, groupId) => {
    if (members.length < 2) return;
    const anchor = members.find((m) => m.family_relationship === "Head") ?? members[0];
    leaderboard.push({
      family_group_id: groupId,
      referrer_name: anchor.name,
      referrer_patient_code: anchor.patient_code,
      member_count: members.length,
    });
  });

  leaderboard.sort((a, b) => b.member_count - a.member_count);
  return leaderboard.slice(0, 50);
}
export async function fetchFamilyMembers(patientId: string) {
  const me = await fetchPatientById(patientId);
  if (!me?.family_group_id) return [];
  const { data, error } = await supabase
    .from("patients")
    .select("id, name, mobile, age, gender, family_relationship, last_visit_date, patient_code")
    .eq("family_group_id", me.family_group_id)
    .neq("id", patientId)
    .limit(50);
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
    // Phase 1 #15 — same backup queue as uploadCasePhoto above.
    supabase.from("storage_backup_queue").insert({ bucket: "patient-documents", path }).then(({ error: qErr }) => {
      if (qErr) console.error("storage_backup_queue enqueue failed:", qErr.message);
    });
    // 04 Aug 2026 fix: same reasoning as uploadCasePhoto above — store the
    // raw path, not a getPublicUrl() result the Private bucket can't
    // actually serve. resolveDocUrl() (used by every reader) already
    // handles a bare path.
    const { error } = await supabase.from("patient_documents").insert({
      patient_id: patientId,
      doc_type: docType,
      photo_url: path,
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
    .select("id,visit_id,amount_received,amount_charged,balance_due,branch,payment_mode")
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
  // Was fixed cash/upi/card/other fields — 10 Aug 2026, replaced with a
  // dynamic per-mode breakdown (see fetchModeBreakdown) so a payment split
  // across multiple modes, or a newly-added Owner mode, both show up
  // correctly instead of falling into an undifferentiated "other" bucket.
  const byMode = await fetchModeBreakdown(pays.map((r: any) => r.id));
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
    byMode,
    bajaj: visits.filter((v: any) => v.branch === "BAJAJ_NAGAR").length,
    jagat: visits.filter((v: any) => v.branch === "JAGATPURA").length,
  };
}

// Single source of truth for the two branch enum keys — was duplicated
// as slightly different local arrays (some enum-keyed, some display-
// label-keyed) across appointments.tsx, register.tsx, pharmacy.inventory
// .tsx, owner.reports.tsx, pharmacy.master.tsx, owner.import.tsx.
export const BRANCH_KEYS = ["BAJAJ_NAGAR", "JAGATPURA"] as const;

export function branchLabel(b: string | null | undefined): string {
  if (b === "BAJAJ_NAGAR") return "Bajaj Nagar";
  if (b === "JAGATPURA") return "Jagatpura";
  return b ?? "";
}

// Display-label counterpart of BRANCH_KEYS — for the several files that
// just needed ["Bajaj Nagar", "Jagatpura"] for a button/filter row, not
// the enum keys themselves.
export const BRANCH_LABELS = BRANCH_KEYS.map(branchLabel);

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

// Same convention markDispensed()/dispense_visit_atomic already use to
// decrement inventory (Dr. Yadav's own words, an earlier session: exact
// drops aren't fixed, staff already eyeballs the physical bottle — this
// is approximate by design, not a precise dose). Surfacing it as text on
// the Pharmacy dispense screen so it's not tribal knowledge for whoever's
// on shift that day.
export function dispenseQuantityLabel(isSlx: boolean): string {
  return isSlx ? "SLX — 4 dram (poori 45ml bottle)" : "Drops — 0.5 dram";
}

export function maskMobile(m: string | null | undefined): string {
  if (!m) return "";
  const s = String(m);
  if (s.length < 6) return s;
  return s.slice(0, 2) + "XXXX" + s.slice(-4);
}


// ─── WhatsApp Delivery Dashboard (Phase 3 #26, 01 Aug 2026) ────────────────
// Reads whatsapp_log / wa_consent_log — see migration 0019. Both tables are
// written server-side only (edge functions + the wa_consent trigger), never
// from the frontend, so there is no corresponding write function here.

export interface WhatsAppLogEntry {
  id: string;
  patient_id: string | null;
  campaign_name: string;
  destination: string | null;
  status: "sent" | "failed" | "skipped_consent" | "skipped_disabled" | "skipped_cap";
  error_message: string | null;
  created_at: string;
  patient?: { name: string; patient_code?: string | null } | null;
}

// ─── WhatsApp master/module switches + daily caps (10 Aug 2026) ────────────
// Requested by Dr. Yadav ahead of a large historical-data import: stay
// fully automatic day to day, but be able to instantly pause everything (or
// just one campaign) during testing, cap per-day sends per campaign to
// control AiSensy cost, and snap back to full-automatic in one action — with
// every skip visible on the dashboard, never silent. The actual gate check
// lives inline in each of the 5 sending Edge Functions (send-whatsapp +
// the 4 crons) — see their "NOTE ON INLINED HELPERS" comments — this is
// just the Owner-facing read/write side of the same `whatsapp_controls`
// settings key those functions read.
export const WHATSAPP_CAMPAIGNS = [
  "REGISTRATION_CONFIRM",
  "APPOINTMENT_REMINDER",
  "FOLLOWUP_REMINDER",
  "BIRTHDAY_WISH",
  "ANNIVERSARY_WISH",
  "HOLIDAY_GREETING",
  "WINBACK",
] as const;
export type WhatsAppCampaign = (typeof WHATSAPP_CAMPAIGNS)[number];

export interface WhatsAppModuleControl {
  enabled: boolean;
  dailyCap: number | null; // null = unlimited
}
export interface WhatsAppControls {
  masterEnabled: boolean;
  modules: Record<WhatsAppCampaign, WhatsAppModuleControl>;
}

export const DEFAULT_WHATSAPP_CONTROLS: WhatsAppControls = {
  masterEnabled: true,
  modules: Object.fromEntries(WHATSAPP_CAMPAIGNS.map((c) => [c, { enabled: true, dailyCap: null }])) as WhatsAppControls["modules"],
};

export async function fetchWhatsAppControls(): Promise<WhatsAppControls> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "whatsapp_controls").maybeSingle();
  if (error) console.error("fetchWhatsAppControls failed:", error.message);
  if (!data?.value) return DEFAULT_WHATSAPP_CONTROLS;
  try {
    const parsed = JSON.parse(data.value);
    return {
      masterEnabled: parsed.masterEnabled ?? true,
      modules: {
        ...DEFAULT_WHATSAPP_CONTROLS.modules,
        ...(parsed.modules ?? {}),
      },
    };
  } catch {
    return DEFAULT_WHATSAPP_CONTROLS;
  }
}

export async function saveWhatsAppControls(controls: WhatsAppControls) {
  await upsertSetting("whatsapp_controls", JSON.stringify(controls));
}

// One-click return to "fully automatic" — master on, every module on, no
// caps — so pausing for a test/import doesn't turn into having to remember
// and manually re-toggle 7 separate switches afterward.
export async function resetWhatsAppToFullAutomatic() {
  await saveWhatsAppControls(DEFAULT_WHATSAPP_CONTROLS);
}

export async function fetchWhatsAppLog(opts?: {
  status?: "sent" | "failed" | "skipped_consent" | "skipped_disabled" | "skipped_cap";
  campaign?: string;
  limit?: number;
}): Promise<WhatsAppLogEntry[]> {
  let q = supabase
    .from("whatsapp_log")
    .select("id, patient_id, campaign_name, destination, status, error_message, created_at, patients(name, patient_code)")
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.status) q = q.eq("status", opts.status);
  if (opts?.campaign) q = q.eq("campaign_name", opts.campaign);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []).map((r: any) => ({ ...r, patient: r.patients ?? null }));
}

export interface WhatsAppStats {
  sentToday: number;
  failedToday: number;
  skippedToday: number;
  // 10 Aug 2026 — split out from the generic "skipped" bucket so a paused
  // switch or a hit cap is visible as its own number, not lumped in with
  // no-consent skips (which mean something operationally different).
  disabledToday: number;
  cappedToday: number;
  sentWeek: number;
  failedWeek: number;
  skippedWeek: number;
  disabledWeek: number;
  cappedWeek: number;
  // sentToday specifically (not just week) is what the WhatsApp Controls
  // panel shows next to each module's cap input ("Aaj: 3/5 bheja") — the
  // whole point of Dr. Yadav's "cap ka mention nahi kiya" feedback (10 Aug
  // 2026) was that the cap and how close you are to it weren't visible
  // anywhere, only editable blind.
  byCampaign: { campaign_name: string; sent: number; sentToday: number; failed: number }[];
}

export async function fetchWhatsAppStats(): Promise<WhatsAppStats> {
  const empty: WhatsAppStats = {
    sentToday: 0, failedToday: 0, skippedToday: 0, disabledToday: 0, cappedToday: 0,
    sentWeek: 0, failedWeek: 0, skippedWeek: 0, disabledWeek: 0, cappedWeek: 0,
    byCampaign: [],
  };
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("whatsapp_log")
    .select("status, campaign_name, created_at")
    .gte("created_at", weekStart.toISOString());
  if (error || !data) return empty;

  const todayISO = todayStart.toISOString();
  const stats = { ...empty };
  const campaignMap = new Map<string, { sent: number; sentToday: number; failed: number }>();

  for (const row of data as any[]) {
    const isToday = row.created_at >= todayISO;
    if (row.status === "sent") {
      stats.sentWeek++;
      if (isToday) stats.sentToday++;
    } else if (row.status === "failed") {
      stats.failedWeek++;
      if (isToday) stats.failedToday++;
    } else if (row.status === "skipped_consent") {
      stats.skippedWeek++;
      if (isToday) stats.skippedToday++;
    } else if (row.status === "skipped_disabled") {
      stats.disabledWeek++;
      if (isToday) stats.disabledToday++;
    } else if (row.status === "skipped_cap") {
      stats.cappedWeek++;
      if (isToday) stats.cappedToday++;
    }
    const c = campaignMap.get(row.campaign_name) ?? { sent: 0, sentToday: 0, failed: 0 };
    if (row.status === "sent") {
      c.sent++;
      if (isToday) c.sentToday++;
    }
    if (row.status === "failed") c.failed++;
    campaignMap.set(row.campaign_name, c);
  }

  stats.byCampaign = Array.from(campaignMap.entries())
    .map(([campaign_name, v]) => ({ campaign_name, ...v }))
    .sort((a, b) => b.sent + b.failed - (a.sent + a.failed));
  return stats;
}

export interface ConsentChange {
  id: string;
  patient_id: string;
  old_value: boolean | null;
  new_value: boolean;
  changed_at: string;
  patient?: { name: string } | null;
}

export async function fetchRecentConsentChanges(limit = 20): Promise<ConsentChange[]> {
  const { data, error } = await supabase
    .from("wa_consent_log")
    .select("id, patient_id, old_value, new_value, changed_at, patients(name)")
    .order("changed_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((r: any) => ({ ...r, patient: r.patients ?? null }));
}

// ─── Full Audit Log (Phase 3 #23, 01 Aug 2026) ──────────────────────────────
// Reads the (extended) audit_log table — see migration 0020. Rows are
// written server-side only, by the generic DB trigger (plus the older,
// unrelated STOCK_ISSUE hand-written insert in reportStockIssue() above,
// which still uses the original action/table_name/record_id/new_value
// columns and is untouched). Owner-only — gated at the route level via
// AuthGate, same pattern as every other Owner-only screen (RLS is still
// off project-wide, a known deferred gap, not new to this feature).

export const AUDIT_TABLES = [
  "patients", "visits", "prescriptions", "payments", "settings",
  "users", "deliveries", "appointments", "leads", "followups", "inventory",
] as const;

export interface AuditLogEntry {
  id: string;
  table_name: string;
  record_id: string | null;
  action: string; // INSERT | UPDATE | DELETE | STOCK_ISSUE (legacy)
  actor_id: string | null;
  actor_role: string | null;
  old_data: Record<string, any> | null;
  new_data: Record<string, any> | null;
  new_value: string | null; // legacy STOCK_ISSUE note — unrelated to old_data/new_data
  created_at: string;
  users?: { name: string; role: string } | null;
}

export async function fetchAuditLog(opts?: {
  table?: string;
  action?: string;
  recordId?: string;
  limit?: number;
}): Promise<AuditLogEntry[]> {
  let q = supabase
    .from("audit_log")
    .select("*, users(name, role)")
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 150);
  if (opts?.table) q = q.eq("table_name", opts.table);
  if (opts?.action) q = q.eq("action", opts.action);
  if (opts?.recordId) q = q.eq("record_id", opts.recordId);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as unknown as AuditLogEntry[];
}

export interface AuditFieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

// UPDATE rows store the FULL old/new row (the decision was "full detail",
// not just a diff) — this just makes the dashboard readable by surfacing
// only the fields that actually changed, instead of dumping every column
// on every row (most columns don't change on a typical update).
export function diffAuditFields(entry: AuditLogEntry): AuditFieldDiff[] {
  if (!entry.old_data || !entry.new_data) return [];
  const keys = new Set([...Object.keys(entry.old_data), ...Object.keys(entry.new_data)]);
  const diffs: AuditFieldDiff[] = [];
  keys.forEach((k) => {
    const before = entry.old_data![k];
    const after = entry.new_data![k];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      diffs.push({ field: k, before, after });
    }
  });
  return diffs;
}

// Best-effort human label for a row, since different audited tables have
// completely different shapes (a patient has a name, a payment doesn't).
export function auditRowLabel(entry: AuditLogEntry): string {
  const row = entry.new_data ?? entry.old_data ?? {};
  return (
    row.name ?? row.patient_code ?? row.key ?? row.token_number ??
    row.campaign_name ?? row.title ?? (row.amount != null ? `₹${row.amount}` : null) ??
    entry.record_id ?? "—"
  );
}

// ─── Clinical photo timeline (Aug 2026) ────────────────────────────────────
// The doctor used to have to hunt: case/tongue/report photos lived on the
// visit row of whichever visit they were taken in, and staff-uploaded
// documents lived in patient_documents. Nothing showed them together.
// This merges both sources for one patient into a single date-descending
// timeline, with short-lived signed URLs minted per item at read time
// (buckets are private — see resolveDocUrl).
export interface PhotoTimelineItem {
  id: string;
  url: string;
  label: string;
  date: string;
  note: string | null;
  source: "visit" | "document";
}

export async function fetchPatientPhotoTimeline(
  patientId: string,
  limitVisits = 40,
): Promise<PhotoTimelineItem[]> {
  const [visitsRes, docs] = await Promise.all([
    supabase
      .from("visits")
      .select("id,visit_date,chief_complaint,case_photo_url,tongue_photo_url,reports_photo_url")
      .eq("patient_id", patientId)
      .order("visit_date", { ascending: false })
      .limit(limitVisits),
    fetchPatientDocuments(patientId),
  ]);

  const raw: { id: string; stored: string; bucket: "case-photos" | "patient-documents"; label: string; date: string; note: string | null; source: "visit" | "document" }[] = [];

  for (const v of (visitsRes.data ?? []) as any[]) {
    const kinds: [string, string | null][] = [
      ["Case paper", v.case_photo_url],
      ["Tongue", v.tongue_photo_url],
      ["Reports", v.reports_photo_url],
    ];
    for (const [label, stored] of kinds) {
      if (!stored) continue;
      raw.push({
        id: `${v.id}-${label}`,
        stored,
        bucket: "case-photos",
        label,
        date: v.visit_date,
        note: v.chief_complaint ?? null,
        source: "visit",
      });
    }
  }

  for (const d of docs) {
    raw.push({
      id: d.id,
      stored: d.photo_url,
      bucket: "patient-documents",
      label: d.doc_type,
      date: (d.created_at ?? "").slice(0, 10),
      note: d.note,
      source: "document",
    });
  }

  const resolved = await Promise.all(
    raw.map(async (r) => {
      const url = await resolveDocUrl(r.bucket, r.stored);
      return url ? ({ id: r.id, url, label: r.label, date: r.date, note: r.note, source: r.source } as PhotoTimelineItem) : null;
    }),
  );

  return resolved
    .filter((r): r is PhotoTimelineItem => !!r)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
