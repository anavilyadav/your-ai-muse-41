// In-memory dummy store for YHC reception app. Replaced with Supabase later.
import { useSyncExternalStore } from "react";

export type PatientStatus =
  | "Waiting"
  | "In Consult"
  | "Pharmacy"
  | "Pay Due"
  | "Done";

export type Branch = "Bajaj Nagar" | "Jagatpura";
export type PaymentMode = "Cash" | "UPI" | "QR" | "Card";

export interface Patient {
  id: string;
  token: string;
  name: string;
  mobile: string;
  age: number;
  gender: string;
  chiefComplaint: string;
  branch: Branch;
  visitType: string;
  source: string;
  status: PatientStatus;
  arrivedAt: number;
  amountPaid: number;
  amountDue: number;
  paymentMode?: PaymentMode;
  paymentNote?: string;
}

// Base "now" for seed offsets. SSR and client will differ slightly, but these
// values are only rendered after client mount (guarded by a `now` state), so
// there is no hydration mismatch.
const T0 = Date.now();

const seed: Patient[] = [
  {
    id: "YHC-1001", token: "T-01", name: "Ramesh Sharma", mobile: "9876500001",
    age: 45, gender: "Male", chiefComplaint: "Joint pain (knee)",
    branch: "Bajaj Nagar", visitType: "Pre-booked", source: "Patient Referral",
    status: "In Consult", arrivedAt: T0 - 32 * 60_000, amountPaid: 500, amountDue: 0,
  },
  {
    id: "YHC-1002", token: "T-02", name: "Sunita Verma", mobile: "9876500002",
    age: 38, gender: "Female", chiefComplaint: "Migraine",
    branch: "Bajaj Nagar", visitType: "Walk-in", source: "Google",
    status: "Waiting", arrivedAt: T0 - 18 * 60_000, amountPaid: 0, amountDue: 300,
  },
  {
    id: "YHC-1003", token: "T-03", name: "Aarav Gupta", mobile: "9876500003",
    age: 12, gender: "Male", chiefComplaint: "Skin allergy",
    branch: "Jagatpura", visitType: "Walk-in", source: "Instagram",
    status: "Pharmacy", arrivedAt: T0 - 55 * 60_000, amountPaid: 600, amountDue: 0,
  },
  {
    id: "YHC-1004", token: "T-04", name: "Priya Nair", mobile: "9876500004",
    age: 29, gender: "Female", chiefComplaint: "PCOS follow-up",
    branch: "Bajaj Nagar", visitType: "Pre-booked", source: "Doctor Referral",
    status: "Pay Due", arrivedAt: T0 - 70 * 60_000, amountPaid: 0, amountDue: 500,
  },
  {
    id: "YHC-1005", token: "T-05", name: "Mohan Lal", mobile: "9876500005",
    age: 62, gender: "Male", chiefComplaint: "Hypertension",
    branch: "Jagatpura", visitType: "Pre-booked", source: "WhatsApp",
    status: "Done", arrivedAt: T0 - 120 * 60_000, amountPaid: 750, amountDue: 0,
  },
  {
    id: "YHC-1006", token: "T-06", name: "Neha Jain", mobile: "9876500006",
    age: 34, gender: "Female", chiefComplaint: "Anxiety / sleep issues",
    branch: "Bajaj Nagar", visitType: "Walk-in", source: "JustDial",
    status: "Waiting", arrivedAt: T0 - 8 * 60_000, amountPaid: 0, amountDue: 300,
  },
];

// ---------- Follow-up records ----------
export type FollowUpStatus = "Pending" | "Called" | "Done";
export interface FollowUp {
  id: string;
  patientName: string;
  mobile: string;
  disease: string;
  lastVisit: number; // ms epoch
  status: FollowUpStatus;
}

const followSeed: FollowUp[] = [
  { id: "F-01", patientName: "Ramesh Sharma", mobile: "9876500001", disease: "Joint pain", lastVisit: T0 - 12 * 86_400_000, status: "Pending" },
  { id: "F-02", patientName: "Sunita Verma",  mobile: "9876500002", disease: "Migraine",   lastVisit: T0 - 9  * 86_400_000, status: "Pending" },
  { id: "F-03", patientName: "Aarav Gupta",   mobile: "9876500003", disease: "Skin allergy", lastVisit: T0 - 4 * 86_400_000, status: "Pending" },
  { id: "F-04", patientName: "Priya Nair",    mobile: "9876500004", disease: "PCOS",       lastVisit: T0 - 2 * 86_400_000, status: "Called" },
  { id: "F-05", patientName: "Mohan Lal",     mobile: "9876500005", disease: "Hypertension", lastVisit: T0 - 30 * 86_400_000, status: "Pending" },
  { id: "F-06", patientName: "Neha Jain",     mobile: "9876500006", disease: "Anxiety",    lastVisit: T0 - 1 * 86_400_000, status: "Done" },
];

let patients: Patient[] = [...seed];
let follows: FollowUp[] = [...followSeed];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function nextToken(): string {
  const n = patients.length + 1;
  return `T-${String(n).padStart(2, "0")}`;
}
function nextId(): string {
  const maxN = patients.reduce((m, p) => {
    const n = Number(p.id.replace("YHC-", ""));
    return Number.isFinite(n) && n > m ? n : m;
  }, 1000);
  return `YHC-${maxN + 1}`;
}

export function isDuplicateMobile(mobile: string) {
  return patients.some((p) => p.mobile === mobile);
}

export function addPatient(
  input: Omit<Patient, "id" | "token" | "status" | "arrivedAt" | "amountPaid" | "amountDue">,
): Patient {
  const p: Patient = {
    ...input,
    id: nextId(),
    token: nextToken(),
    status: "Waiting",
    arrivedAt: Date.now(),
    amountPaid: 0,
    amountDue: 300,
  };
  patients = [...patients, p];
  emit();
  return p;
}

export function getPatientById(id: string) {
  return patients.find((p) => p.id === id);
}

export function collectPayment(
  id: string,
  amount: number,
  mode: PaymentMode,
  opts: { note?: string; partial?: boolean; credit?: boolean } = {},
) {
  patients = patients.map((p) =>
    p.id === id
      ? {
          ...p,
          amountPaid: p.amountPaid + amount,
          amountDue: Math.max(0, p.amountDue - amount),
          paymentMode: mode,
          paymentNote: opts.note,
          status: opts.credit ? "Pay Due" : opts.partial ? "Pay Due" : "Done",
        }
      : p,
  );
  emit();
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function getPatients() {
  return patients;
}
export function usePatients() {
  return useSyncExternalStore(subscribe, getPatients, getPatients);
}

// Follow-ups
export function getFollowUps() { return follows; }
export function useFollowUps() {
  return useSyncExternalStore(subscribe, getFollowUps, getFollowUps);
}
export function updateFollowUp(id: string, status: FollowUpStatus) {
  follows = follows.map((f) => (f.id === id ? { ...f, status } : f));
  emit();
}

export function formatWait(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h ${r}m`;
}

export function daysSince(ms: number) {
  return Math.floor((Date.now() - ms) / 86_400_000);
}

// ---------- Leads ----------
export type LeadStatus = "HOT" | "Warm" | "Cold" | "Converted" | "Lost";
export type LeadSource = "JustDial" | "Google" | "Instagram" | "Walk-in" | "Referral";
export interface Lead {
  id: string;
  name: string;
  mobile: string;
  source: LeadSource;
  status: LeadStatus;
  enquiredAt: number;
  note?: string;
}

const leadSeed: Lead[] = [
  { id: "L-01", name: "Kavita Sharma",  mobile: "9876511111", source: "JustDial",  status: "HOT",       enquiredAt: T0 - 0.4 * 86_400_000, note: "Migraine, urgent" },
  { id: "L-02", name: "Rahul Meena",    mobile: "9876522222", source: "Google",    status: "Warm",      enquiredAt: T0 - 2   * 86_400_000, note: "Skin issue" },
  { id: "L-03", name: "Anjali Yadav",   mobile: "9876533333", source: "Instagram", status: "HOT",       enquiredAt: T0 - 0.1 * 86_400_000, note: "PCOS" },
  { id: "L-04", name: "Vikram Singh",   mobile: "9876544444", source: "Referral",  status: "Converted", enquiredAt: T0 - 8   * 86_400_000 },
  { id: "L-05", name: "Meera Agarwal",  mobile: "9876555555", source: "Walk-in",   status: "Cold",      enquiredAt: T0 - 14  * 86_400_000 },
  { id: "L-06", name: "Deepak Jain",    mobile: "9876566666", source: "Google",    status: "Warm",      enquiredAt: T0 - 5   * 86_400_000, note: "Joint pain, dad" },
  { id: "L-07", name: "Pooja Rathore",  mobile: "9876577777", source: "JustDial",  status: "Converted", enquiredAt: T0 - 20  * 86_400_000 },
];

let leads: Lead[] = [...leadSeed];
export function getLeads() { return leads; }
export function useLeads() { return useSyncExternalStore(subscribe, getLeads, getLeads); }
export function updateLeadStatus(id: string, status: LeadStatus) {
  leads = leads.map((l) => (l.id === id ? { ...l, status } : l));
  emit();
}
export function maskMobile(m: string) {
  if (m.length < 6) return m;
  return `${m.slice(0, 2)}XXXX${m.slice(-4)}`;
}

// ---------- Deliveries ----------
export type DeliveryPartner = "Swiggy" | "Porter" | "Courier" | "Self-pickup";
export type DeliveryStatus = "Packed" | "Dispatched" | "Out for Delivery" | "Delivered" | "Issue";
export const DELIVERY_STEPS: DeliveryStatus[] = ["Packed", "Dispatched", "Out for Delivery", "Delivered"];
export interface Delivery {
  id: string;
  patientName: string;
  token: string;
  partner: DeliveryPartner;
  status: DeliveryStatus;
  area: string;
  note?: string;
}

const deliverySeed: Delivery[] = [
  { id: "D-01", patientName: "Ramesh Sharma", token: "T-01", partner: "Swiggy",      status: "Out for Delivery", area: "Bajaj Nagar" },
  { id: "D-02", patientName: "Sunita Verma",  token: "T-02", partner: "Porter",      status: "Dispatched",       area: "Malviya Nagar" },
  { id: "D-03", patientName: "Aarav Gupta",   token: "T-03", partner: "Courier",     status: "Packed",           area: "Jagatpura" },
  { id: "D-04", patientName: "Priya Nair",    token: "T-04", partner: "Self-pickup", status: "Packed",           area: "C-Scheme" },
  { id: "D-05", patientName: "Mohan Lal",     token: "T-05", partner: "Swiggy",      status: "Delivered",        area: "Mansarovar" },
  { id: "D-06", patientName: "Neha Jain",     token: "T-06", partner: "Courier",     status: "Issue",            area: "Vaishali Nagar", note: "Address mismatch" },
];

let deliveries: Delivery[] = [...deliverySeed];
export function getDeliveries() { return deliveries; }
export function useDeliveries() { return useSyncExternalStore(subscribe, getDeliveries, getDeliveries); }
export function updateDelivery(id: string, patch: Partial<Delivery>) {
  deliveries = deliveries.map((d) => (d.id === id ? { ...d, ...patch } : d));
  emit();
}
