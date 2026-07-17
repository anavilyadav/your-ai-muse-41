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

// Fixed base timestamp so SSR + client agree (no Date.now at module init).
const T0 = 1_700_000_000_000;

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
