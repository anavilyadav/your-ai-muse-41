import { createClient } from "@supabase/supabase-js";

// Single source of truth for this project's real Supabase URL — do NOT
// read VITE_SUPABASE_URL for this; that env var is still set to the old,
// unused Lovable Cloud project ref (ykaglkrqmppcldzhgflq) in .env and
// would silently point requests at the wrong project.
export const SUPABASE_URL = "https://swekxnhvecrcpiuteqmj.supabase.co";
const anon =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3ZWt4bmh2ZWNyY3BpdXRlcW1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MDYyOTAsImV4cCI6MjEwMDE4MjI5MH0.Tt7SXchQ8TJxOZKEqW9UJwLZuEPmKq1azJ-3ykh7jVI";

export const supabase = createClient(SUPABASE_URL, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "yhc-auth",
  },
});

export type Role = "OWNER" | "RECP1" | "RECP2" | "DOCTOR" | "CASE_DR" | "PHARMA";

export interface AppUser {
  id: string;
  name: string;
  mobile: string;
  role: Role;
  branch: string | null;
}

export function roleHome(role: Role): string {
  if (role === "OWNER") return "/owner";
  if (role === "DOCTOR" || role === "CASE_DR") return "/doctor";
  if (role === "PHARMA") return "/pharmacy";
  return "/"; // RECP1/RECP2
}

// JS Date has no real timezone awareness — this shifts the current
// instant forward by IST's UTC+5:30 offset, so reading it back with
// UTC getters (toISOString, getUTCDate, etc.) gives IST calendar values.
// Same trick already used by istDayStart/istDayEnd/istDateOf in db.ts —
// exported here as the one shared version instead of resembling logic
// living in multiple places.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export function istNow(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

// Was new Date().toISOString().slice(0,10) — plain UTC. Between
// 12:00am-5:30am IST that returned YESTERDAY's date (UTC hasn't rolled
// over to the new day yet), so a visit/registration logged in that
// window silently landed under the wrong calendar day everywhere
// this is used (visit_date, token generation, day/week/month totals).
export const today = () => istNow().toISOString().slice(0, 10);
