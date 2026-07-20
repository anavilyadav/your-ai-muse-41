// Doctor app config + dummy data. Backend-ready shape.
import { useEffect, useState } from "react";

export const DOCTOR_CONFIG = {
  prescribingDoctors: [
    { id: "dr1", name: "Dr. Anavil Yadav", tag: "Owner" },
    { id: "dr2", name: "Dr. T. P. Yadav", tag: "Senior" },
    { id: "dr3", name: "Backup Doctor", tag: "Time-bound" },
  ],
  medicines: [
    "Sulphur", "Nux Vomica", "Pulsatilla", "Lycopodium", "Calcarea Carb",
    "Arsenicum", "Bryonia", "Rhus Tox", "Belladonna", "Sepia", "Natrum Mur",
    "Phosphorus", "Ignatia", "Lachesis", "Mercurius", "Thuja", "Silicea",
    "Apis", "Aconite", "Hepar Sulph",
  ],
  potencies: ["6C", "30C", "200C", "1M", "10M", "CM", "3X", "6X", "Q"],
  doseForms: ["Globules", "Drops", "Tablets", "Powder"],
  frequencies: ["OD", "BD", "TDS", "Weekly", "Fortnightly", "Monthly", "SOS"],
  anupan: ["Water", "Milk", "Empty stomach"],
  nextVisit: ["1 week", "2 weeks", "1 month", "6 weeks", "2 months", "3 months"],
  outcomes: ["Major improvement", "Moderate", "Stable", "Aggravation", "Worse", "New patient"],
  defaultCharges: 300,
  chargesWarnDiff: 100,
};

export interface RxPatient {
  token: string;
  name: string;
  age: number;
  gender: string;
  complaint: string;
  caseBy: string;
  visit: number;
  lastRx: string;
  vip: boolean;
}

export const RX_QUEUE: RxPatient[] = [
  { token: "T-01", name: "Ramesh Sharma", age: 54, gender: "Male", complaint: "Knee pain (chronic)", caseBy: "Dr. Priya (Case)", visit: 8, lastRx: "Rhus Tox 200C", vip: false },
  { token: "T-03", name: "Aarav Gupta", age: 22, gender: "Male", complaint: "Skin allergy", caseBy: "Dr. Amit (Case)", visit: 1, lastRx: "New patient", vip: false },
  { token: "T-06", name: "Neha Jain", age: 31, gender: "Female", complaint: "Anxiety / sleep issues", caseBy: "Dr. Priya (Case)", visit: 2, lastRx: "Ignatia 30C", vip: true },
  { token: "T-08", name: "Sanjay Rao", age: 45, gender: "Male", complaint: "Migraine", caseBy: "Dr. Amit (Case)", visit: 4, lastRx: "Nux Vomica 200C", vip: false },
];

export interface HistoryEntry {
  date: string;
  med: string;
  potency: string;
  outcome: string;
  notes: string;
}

export const RX_HISTORY: Record<string, HistoryEntry[]> = {
  "T-01": [
    { date: "20 Jun 2026", med: "Rhus Tox", potency: "200C", outcome: "Moderate improvement", notes: "Stiffness reduced, mornings better." },
    { date: "5 Jun 2026", med: "Bryonia", potency: "30C", outcome: "Stable", notes: "No aggravation, continue." },
    { date: "18 May 2026", med: "Calcarea Carb", potency: "200C", outcome: "Major improvement", notes: "Pain down ~60%." },
    { date: "2 May 2026", med: "Rhus Tox", potency: "30C", outcome: "New patient", notes: "First consult, chronic knee pain 3 yrs." },
  ],
  "T-06": [
    { date: "14 Jul 2026", med: "Ignatia", potency: "30C", outcome: "Moderate", notes: "Sleep improved, mood swings less." },
    { date: "1 Jul 2026", med: "Nat Mur", potency: "200C", outcome: "New patient", notes: "Grief history, anxiety." },
  ],
};

export interface CaseBoardItem {
  token: string;
  name: string;
  age: number;
  gender: string;
  marital: string;
  job: string;
  complaint: string;
  status: "Pending" | "In Progress" | "Submitted";
}

export const CASE_BOARD: CaseBoardItem[] = [
  { token: "T-02", name: "Sunita Verma", age: 38, gender: "Female", marital: "Married", job: "Teacher", complaint: "Migraine", status: "Pending" },
  { token: "T-05", name: "Mohan Lal", age: 62, gender: "Male", marital: "Married", job: "Retired", complaint: "Hypertension", status: "In Progress" },
  { token: "T-07", name: "Kavita Singh", age: 28, gender: "Female", marital: "Single", job: "Software Engineer", complaint: "Hair fall", status: "Submitted" },
  { token: "T-09", name: "Rajesh Kumar", age: 50, gender: "Male", marital: "Married", job: "Shopkeeper", complaint: "Joint pain", status: "Pending" },
];

export function getRxPatient(token: string): RxPatient | undefined {
  return RX_QUEUE.find((p) => p.token === token);
}
export function getCaseItem(token: string): CaseBoardItem | undefined {
  return CASE_BOARD.find((p) => p.token === token);
}

// ---------- session (localStorage) ----------
export interface DoctorSession {
  role: "rx" | "case";
  name: string;
}
const KEY = "yhc-doctor-session";

export function readDoctorSession(): DoctorSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DoctorSession) : null;
  } catch {
    return null;
  }
}

export function writeDoctorSession(s: DoctorSession | null) {
  if (typeof window === "undefined") return;
  if (s) window.localStorage.setItem(KEY, JSON.stringify(s));
  else window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("yhc-doctor-session"));
}

export function useDoctorSession(): DoctorSession | null {
  const [s, setS] = useState<DoctorSession | null>(null);
  useEffect(() => {
    setS(readDoctorSession());
    const onChange = () => setS(readDoctorSession());
    window.addEventListener("yhc-doctor-session", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("yhc-doctor-session", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return s;
}
