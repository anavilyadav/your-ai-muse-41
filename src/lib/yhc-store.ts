// In-memory dummy store for YHC reception app. Replaced with Supabase later.
import { useSyncExternalStore } from "react";

export type PatientStatus =
  | "Waiting"
  | "In Consult"
  | "Pharmacy"
  | "Pay Due"
  | "Done";

export type Branch = "Bajaj Nagar" | "Jagatpura";

export interface Patient {
  id: string; // YHC-XXXX
  token: string; // T-01
  name: string;
  mobile: string;
  age: number;
  gender: string;
  chiefComplaint: string;
  branch: Branch;
  visitType: string;
  source: string;
  status: PatientStatus;
  arrivedAt: number; // ms
  amountPaid: number;
}

const seed: Patient[] = [
  {
    id: "YHC-1001", token: "T-01", name: "Ramesh Sharma", mobile: "9876500001",
    age: 45, gender: "Male", chiefComplaint: "Joint pain (knee)",
    branch: "Bajaj Nagar", visitType: "Pre-booked", source: "Patient Referral",
    status: "In Consult", arrivedAt: Date.now() - 32 * 60_000, amountPaid: 500,
  },
  {
    id: "YHC-1002", token: "T-02", name: "Sunita Verma", mobile: "9876500002",
    age: 38, gender: "Female", chiefComplaint: "Migraine",
    branch: "Bajaj Nagar", visitType: "Walk-in", source: "Google",
    status: "Waiting", arrivedAt: Date.now() - 18 * 60_000, amountPaid: 0,
  },
  {
    id: "YHC-1003", token: "T-03", name: "Aarav Gupta", mobile: "9876500003",
    age: 12, gender: "Male", chiefComplaint: "Skin allergy",
    branch: "Jagatpura", visitType: "Walk-in", source: "Instagram",
    status: "Pharmacy", arrivedAt: Date.now() - 55 * 60_000, amountPaid: 600,
  },
  {
    id: "YHC-1004", token: "T-04", name: "Priya Nair", mobile: "9876500004",
    age: 29, gender: "Female", chiefComplaint: "PCOS follow-up",
    branch: "Bajaj Nagar", visitType: "Pre-booked", source: "Doctor Referral",
    status: "Pay Due", arrivedAt: Date.now() - 70 * 60_000, amountPaid: 0,
  },
  {
    id: "YHC-1005", token: "T-05", name: "Mohan Lal", mobile: "9876500005",
    age: 62, gender: "Male", chiefComplaint: "Hypertension",
    branch: "Jagatpura", visitType: "Pre-booked", source: "WhatsApp",
    status: "Done", arrivedAt: Date.now() - 120 * 60_000, amountPaid: 750,
  },
  {
    id: "YHC-1006", token: "T-06", name: "Neha Jain", mobile: "9876500006",
    age: 34, gender: "Female", chiefComplaint: "Anxiety / sleep issues",
    branch: "Bajaj Nagar", visitType: "Walk-in", source: "JustDial",
    status: "Waiting", arrivedAt: Date.now() - 8 * 60_000, amountPaid: 0,
  },
];

let patients: Patient[] = [...seed];
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
  input: Omit<Patient, "id" | "token" | "status" | "arrivedAt" | "amountPaid">,
): Patient {
  const p: Patient = {
    ...input,
    id: nextId(),
    token: nextToken(),
    status: "Waiting",
    arrivedAt: Date.now(),
    amountPaid: 0,
  };
  patients = [...patients, p];
  emit();
  return p;
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

export function formatWait(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h ${r}m`;
}
