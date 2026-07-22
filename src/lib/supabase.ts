import { createClient } from "@supabase/supabase-js";

const url = "https://swekxnhvecrcpiuteqmj.supabase.co";
const anon =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3ZWt4bmh2ZWNyY3BpdXRlcW1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MDYyOTAsImV4cCI6MjEwMDE4MjI5MH0.Tt7SXchQ8TJxOZKEqW9UJwLZuEPmKq1azJ-3ykh7jVI";

export const supabase = createClient(url, anon, {
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

export const today = () => new Date().toISOString().slice(0, 10);
