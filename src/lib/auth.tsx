import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase, SUPABASE_URL, type AppUser, type Role } from "./supabase";
import { withTimeout } from "./db";

export interface BackupDoctorConfig {
  userId: string;
  start: string; // ISO datetime
  end: string; // ISO datetime
  enabled: boolean;
}

export const RECEPTION_SCREENS: { key: string; label: string }[] = [
  { key: "register", label: "Registration" },
  { key: "queue", label: "Queue / Token Board" },
  { key: "search", label: "Patient Search" },
  { key: "patientDetail", label: "Patient Detail" },
  { key: "payment", label: "Payment Collection" },
  { key: "summary", label: "Day Summary" },
  { key: "followup", label: "Follow-up Calls" },
  { key: "leads", label: "Lead CRM" },
  { key: "delivery", label: "Delivery Tracking" },
  { key: "appointments", label: "Appointments" },
  { key: "outstanding", label: "Outstanding Dues" },
  { key: "tasks", label: "Tasks Hub" },
  { key: "caseTracking", label: "Case Tracking (Pending Discussion)" },
];

// 04 Aug 2026 — Operational Manual Part 7B: Owner wanted the same
// granular per-screen ON/OFF control for Case-DR, Doctor, and Pharmacy
// that Reception already had. The underlying mechanism (recp_perm:<role>:
// <key> in `settings`, read by hasReceptionPermission below) was already
// generic — it takes whatever the current effective role is, never
// actually hardcoded to RECP1/RECP2 — so these are just new screen lists
// using the same keys as each route's AuthGate permKey prop.
export const CASE_DR_SCREENS: { key: string; label: string }[] = [
  { key: "caseBoard", label: "Case Board" },
  { key: "caseForm", label: "Case Taking Form" },
  { key: "caseReference", label: "Reference Performa" },
];

export const DOCTOR_SCREENS: { key: string; label: string }[] = [
  { key: "rxQueue", label: "Prescription Queue" },
  { key: "rxConsult", label: "Write Prescription" },
  { key: "rxDashboard", label: "Doctor Dashboard" },
  { key: "rxHistory", label: "Rx History" },
  { key: "caseReference", label: "Reference Performa" },
];

export const PHARMACY_SCREENS: { key: string; label: string }[] = [
  { key: "pharmacyQueue", label: "Pharmacy Queue" },
  { key: "dispense", label: "Dispense Medicine" },
  { key: "inventory", label: "Inventory" },
  { key: "medicineMaster", label: "Medicine Master" },
];

// Phase 1 #11 — feature-level permissions, one layer more granular than
// RECEPTION_SCREENS above. Those gate an ENTIRE screen; these gate one
// specific action inside a screen that's otherwise ON, using the exact
// same recp_perm:<role>:<key> mechanism (hasReceptionPermission doesn't
// care whether the key is a screen or a feature — any string works).
// Starts with one concrete example tied to an existing decision that
// wasn't actually wired up anywhere in code: partial payment was
// supposed to need Owner/Doctor involvement, but any RECP1/RECP2 with
// the Payment screen ON could save one unrestricted. Add more entries
// here as specific actions need their own gate — no new plumbing needed,
// this list plus a hasReceptionPermission(key) check at the action is
// the whole mechanism.
export const RECEPTION_FEATURES: { key: string; label: string }[] = [
  { key: "payment.partial", label: "Partial Payment (full amount na aane par)" },
];

interface AuthCtx {
  user: AppUser | null;
  viewAsRole: Role | null; // OWNER can preview other roles
  loading: boolean;
  // Phase 1 #7 — distinguishes "there is no session, go to /login" from
  // "there IS a valid session, but OUR profile fetch from the users table
  // timed out/failed" (slow network). These must not be treated the same:
  // the old code collapsed both into "no user" once loading finished,
  // which bounced a genuinely-logged-in staff member on slow network
  // straight back to the login screen right after they'd just signed in.
  profileLoadFailed: boolean;
  retryLoadProfile: () => void;
  backupDoctorActive: boolean; // true if THIS user currently has temporary backup-doctor access
  hasReceptionPermission: (screenKey: string) => boolean;
  signIn: (mobile: string, pin: string) => Promise<string | null>; // null = ok, else error msg
  signOut: () => Promise<void>;
  setViewAsRole: (r: Role | null) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

const LS_VIEW = "yhc-viewas";

function isBackupActiveNow(cfg: BackupDoctorConfig | null, userId: string | undefined): boolean {
  if (!cfg || !cfg.enabled || !userId) return false;
  if (cfg.userId !== userId) return false;
  const now = Date.now();
  const start = Date.parse(cfg.start);
  const end = Date.parse(cfg.end);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return now >= start && now <= end;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [viewAsRole, setViewAsRoleState] = useState<Role | null>(null);
  const [backupDoctorActive, setBackupDoctorActive] = useState(false);
  const [receptionPerms, setReceptionPerms] = useState<Record<string, boolean>>({});
  // Distinguishes "loaded successfully, nothing explicitly restricted"
  // from "failed to load, we don't actually know" — these must NOT
  // behave the same way. See hasReceptionPermission below.
  const [permsLoaded, setPermsLoaded] = useState(false);
  const permsLoadedRef = useRef(false);
  const userIdRef = useRef<string | undefined>(undefined);
  // The raw Supabase Auth session's user id — kept separately from `user`
  // (our own users-table profile) so retryLoadProfile knows what to
  // re-fetch even when the profile load itself failed and `user` is null.
  const authUserIdRef = useRef<string | undefined>(undefined);

  const loadUser = async (uid: string) => {
    try {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.from("users").select("id,name,mobile,role,branch").eq("id", uid).maybeSingle()),
        12_000,
        "Load user",
      );
      if (error || !data) return null;
      return data as AppUser;
    } catch {
      // A stalled request here must not leave the whole app stuck on the
      // "Loading…" screen forever (setLoading(false) below only runs
      // after this resolves, one way or another).
      return null;
    }
  };

  // Phase 1 #7: wraps loadUser so a slow-network timeout sets
  // profileLoadFailed=true (session is real, our fetch just didn't
  // finish) instead of leaving the caller to conflate it with "no
  // session at all".
  const attemptLoadUser = async (authUserId: string) => {
    authUserIdRef.current = authUserId;
    const u = await loadUser(authUserId);
    setUser(u);
    setProfileLoadFailed(!u);
    return u;
  };

  const retryLoadProfile = () => {
    const uid = authUserIdRef.current;
    if (!uid) return;
    setLoading(true);
    attemptLoadUser(uid).then(async (u) => {
      userIdRef.current = u?.id;
      await refreshBackupDoctorStatus(u?.id);
      await refreshReceptionPerms();
      setLoading(false);
    });
  };

  const refreshBackupDoctorStatus = async (currentUserId: string | undefined) => {
    if (!currentUserId) {
      setBackupDoctorActive(false);
      return;
    }
    try {
      const { data } = await withTimeout(
        Promise.resolve(supabase.from("settings").select("value").eq("key", "backup_doctor_config").maybeSingle()),
        12_000,
        "Backup-doctor status",
      );
      const cfg: BackupDoctorConfig | null = data?.value ? JSON.parse(data.value) : null;
      setBackupDoctorActive(isBackupActiveNow(cfg, currentUserId));
    } catch {
      setBackupDoctorActive(false);
    }
  };

  const refreshReceptionPerms = async () => {
    try {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.from("settings").select("key,value").like("key", "recp_perm:%")),
        12_000,
        "Reception permissions",
      );
      if (error) throw error;
      const map: Record<string, boolean> = {};
      (data ?? []).forEach((r: any) => {
        map[r.key] = r.value === "true" || r.value === true;
      });
      setReceptionPerms(map);
      setPermsLoaded(true);
      permsLoadedRef.current = true;
    } catch {
      // A fetch failure (or now, a timeout) is NOT the same as "nothing
      // was ever restricted" — audit P1 #14. Leaving permsLoaded false
      // makes hasReceptionPermission fail closed below, instead of
      // silently granting every RECP1/RECP2 screen just because a
      // network blip happened. The dedicated 20s retry loop below means
      // a transient failure self-heals instead of leaving a RECP1/RECP2
      // user locked out of every gated screen for their whole session.
      setReceptionPerms({});
      setPermsLoaded(false);
      permsLoadedRef.current = false;
    }
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      if (data.session?.user) {
        const u = await attemptLoadUser(data.session.user.id);
        if (!mounted) return;
        userIdRef.current = u?.id;
        await refreshBackupDoctorStatus(u?.id);
        await refreshReceptionPerms();
      }
      if (mounted) {
        try {
          const v = localStorage.getItem(LS_VIEW);
          if (v) setViewAsRoleState(v as Role);
        } catch {}
        setLoading(false);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const u = await attemptLoadUser(session.user.id);
        userIdRef.current = u?.id;
        await refreshBackupDoctorStatus(u?.id);
        await refreshReceptionPerms();
      } else {
        // A genuine sign-out/no-session — this is the real "go to
        // /login" case, distinct from a profile-load failure above.
        authUserIdRef.current = undefined;
        setUser(null);
        setProfileLoadFailed(false);
        userIdRef.current = undefined;
        setBackupDoctorActive(false);
      }
    });
    // Re-check every 5 minutes in case a backup window starts/ends mid-session.
    const interval = setInterval(() => refreshBackupDoctorStatus(userIdRef.current), 5 * 60 * 1000);
    // Separate, much faster retry specifically for reception permissions —
    // if the one attempt above failed (network blip), a RECP1/RECP2 user
    // would otherwise stay fail-closed out of every gated screen for the
    // rest of their session. This keeps quietly retrying every 20s until
    // it succeeds, then becomes a no-op (permsLoadedRef.current check is
    // cheap — no real cost to leaving it running for the session).
    const permsRetry = setInterval(() => {
      if (!permsLoadedRef.current && userIdRef.current) refreshReceptionPerms();
    }, 20_000);
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      clearInterval(interval);
      clearInterval(permsRetry);
    };
  }, []);

  // Direct Supabase Auth sign-in — used when the staff-signin edge function
  // is unavailable (not deployed on this project / CORS preflight blocked /
  // offline gateway). Without this the whole app was unusable: the browser
  // never reached the function and every attempt showed the generic
  // "Network issue — dobara try karo".
  const signInDirect = async (cleaned: string, pin: string) => {
    let email = `${cleaned}@yhcos.in`;
    try {
      const { data } = await withTimeout(
        Promise.resolve(supabase.from("users").select("email").eq("mobile", cleaned).maybeSingle()),
        10_000,
        "Email lookup",
      );
      if ((data as any)?.email) email = (data as any).email;
    } catch {
      // fall through with the conventional email
    }
    const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password: pin });
    if (error || !signInData?.session) {
      // A genuine connectivity failure surfaces as a fetch/network error,
      // not as invalid credentials — keep the two messages distinct.
      const msg = String(error?.message ?? "");
      if (/fetch|network|Failed to fetch/i.test(msg)) return "Network issue — dobara try karo";
      return "Mobile ya PIN galat hai";
    }
    return null;
  };

  const signIn = async (mobile: string, pin: string) => {
    const cleaned = mobile.replace(/\D/g, "");
    if (cleaned.length !== 10 || pin.length < 4) return "Mobile ya PIN galat hai";
    // Proxied through staff-signin (audit P1-14) so a server-side lockout
    // (5 failed attempts -> 15 min) can be enforced — calling
    // supabase.auth.signInWithPassword directly here, like before, would
    // have no way to know or care how many times this mobile just failed.
    // If that function isn't reachable we still sign in directly rather
    // than locking every staff member out of the app.
    try {
      const res = await withTimeout(
        fetch(`${SUPABASE_URL}/functions/v1/staff-signin`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mobile: cleaned, pin }),
        }),
        15_000,
        "Sign in",
      );
      // 404 = function not deployed, 5xx = gateway/boot failure. Neither
      // says anything about this user's credentials, so fall back.
      if (res.status === 404 || res.status >= 500) return await signInDirect(cleaned, pin);
      const data = await res.json().catch(() => ({}) as any);
      if (!res.ok || !data?.access_token) {
        return data?.error || "Mobile ya PIN galat hai";
      }
      const { error: setErr } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (setErr) return "Login mein dikkat aayi, dobara try karo";
      return null;
    } catch {
      // Network error / CORS preflight block / timeout — the request never
      // produced a response, so try the direct path before giving up.
      return await signInDirect(cleaned, pin);
    }
  };


  const signOut = async () => {
    await supabase.auth.signOut();
    try {
      localStorage.removeItem(LS_VIEW);
    } catch {}
    setViewAsRoleState(null);
  };

  const setViewAsRole = (r: Role | null) => {
    setViewAsRoleState(r);
    try {
      if (r) localStorage.setItem(LS_VIEW, r);
      else localStorage.removeItem(LS_VIEW);
    } catch {}
  };

  const hasReceptionPermission = (screenKey: string): boolean => {
    if (!user) return false;
    // Mirror useEffectiveRole()'s logic here (not a call to that hook,
    // since this function lives inside AuthProvider itself) — Owner
    // previewing as another role must see the same permission gates a
    // real account of that role would, not "always allowed" just because
    // the underlying account is OWNER.
    const effectiveRole = user.role === "OWNER" && viewAsRole ? viewAsRole : user.role;
    // 04 Aug 2026: was `if (effectiveRole !== "RECP1" && effectiveRole !==
    // "RECP2") return true` — hardcoded to only ever gate those two roles,
    // which meant the Case-DR/Doctor/Pharmacy screen toggles Owner could
    // set in Control Centre (CASE_DR_SCREENS/DOCTOR_SCREENS/
    // PHARMACY_SCREENS below) were saved but silently had no effect: this
    // function returned true regardless before ever checking them. Owner
    // itself must stay ungated (acting as OWNER, not previewing) — every
    // other role is a candidate for gating now.
    if (effectiveRole === "OWNER") return true;
    // Fail closed: if the permissions fetch hasn't succeeded yet (still
    // loading, or failed), we genuinely don't know what's restricted —
    // that must not be treated as "nothing is restricted."
    if (!permsLoaded) return false;
    const k = `recp_perm:${effectiveRole}:${screenKey}`;
    // Default ON (true) if never explicitly toggled off — nothing breaks for existing staff.
    return receptionPerms[k] !== false;
  };

  return (
    <Ctx.Provider
      value={{ user, viewAsRole, loading, profileLoadFailed, retryLoadProfile, backupDoctorActive, hasReceptionPermission, signIn, signOut, setViewAsRole }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be inside AuthProvider");
  return c;
}

/** Effective role: owner can view as another role; a designated backup
 * doctor gets temporary DOCTOR access during their configured window. */
export function useEffectiveRole(): Role | null {
  const { user, viewAsRole, backupDoctorActive } = useAuth();
  if (!user) return null;
  if (user.role === "OWNER" && viewAsRole) return viewAsRole;
  if (backupDoctorActive && user.role !== "OWNER") return "DOCTOR";
  return user.role;
}
