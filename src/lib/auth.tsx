import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase, type AppUser, type Role } from "./supabase";

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
];

interface AuthCtx {
  user: AppUser | null;
  viewAsRole: Role | null; // OWNER can preview other roles
  loading: boolean;
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
  const [viewAsRole, setViewAsRoleState] = useState<Role | null>(null);
  const [backupDoctorActive, setBackupDoctorActive] = useState(false);
  const [receptionPerms, setReceptionPerms] = useState<Record<string, boolean>>({});
  // Distinguishes "loaded successfully, nothing explicitly restricted"
  // from "failed to load, we don't actually know" — these must NOT
  // behave the same way. See hasReceptionPermission below.
  const [permsLoaded, setPermsLoaded] = useState(false);
  const userIdRef = useRef<string | undefined>(undefined);

  const loadUser = async (uid: string) => {
    const { data, error } = await supabase
      .from("users")
      .select("id,name,mobile,role,branch")
      .eq("id", uid)
      .maybeSingle();
    if (error || !data) return null;
    return data as AppUser;
  };

  const refreshBackupDoctorStatus = async (currentUserId: string | undefined) => {
    if (!currentUserId) {
      setBackupDoctorActive(false);
      return;
    }
    try {
      const { data } = await supabase.from("settings").select("value").eq("key", "backup_doctor_config").maybeSingle();
      const cfg: BackupDoctorConfig | null = data?.value ? JSON.parse(data.value) : null;
      setBackupDoctorActive(isBackupActiveNow(cfg, currentUserId));
    } catch {
      setBackupDoctorActive(false);
    }
  };

  const refreshReceptionPerms = async () => {
    try {
      const { data, error } = await supabase.from("settings").select("key,value").like("key", "recp_perm:%");
      if (error) throw error;
      const map: Record<string, boolean> = {};
      (data ?? []).forEach((r: any) => {
        map[r.key] = r.value === "true" || r.value === true;
      });
      setReceptionPerms(map);
      setPermsLoaded(true);
    } catch {
      // A fetch failure is NOT the same as "nothing was ever restricted" —
      // audit P1 #14. Leaving permsLoaded false makes hasReceptionPermission
      // fail closed below, instead of silently granting every RECP1/RECP2
      // screen just because a network blip happened.
      setReceptionPerms({});
      setPermsLoaded(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      if (data.session?.user) {
        const u = await loadUser(data.session.user.id);
        if (mounted) setUser(u);
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
        const u = await loadUser(session.user.id);
        setUser(u);
        userIdRef.current = u?.id;
        await refreshBackupDoctorStatus(u?.id);
        await refreshReceptionPerms();
      } else {
        setUser(null);
        userIdRef.current = undefined;
        setBackupDoctorActive(false);
      }
    });
    // Re-check every 5 minutes in case a backup window starts/ends mid-session.
    const interval = setInterval(() => refreshBackupDoctorStatus(userIdRef.current), 5 * 60 * 1000);
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const signIn = async (mobile: string, pin: string) => {
    const cleaned = mobile.replace(/\D/g, "");
    if (cleaned.length !== 10 || pin.length < 4) return "Mobile ya PIN galat hai";
    const { data: profile } = await supabase
      .from("users")
      .select("email")
      .eq("mobile", cleaned)
      .maybeSingle();
    // Real email if set; falls back to the old synthetic address for
    // accounts created before real emails were supported.
    const email = profile?.email || `${cleaned}@yhcos.in`;
    const { error } = await supabase.auth.signInWithPassword({ email, password: pin });
    if (error) return "Mobile ya PIN galat hai";
    return null;
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
    // previewing as RECP1/RECP2 must see the same permission gates a
    // real RECP1/RECP2 account would, not "always allowed" just because
    // the underlying account is OWNER.
    const effectiveRole = user.role === "OWNER" && viewAsRole ? viewAsRole : user.role;
    if (effectiveRole !== "RECP1" && effectiveRole !== "RECP2") return true; // only gates RECP1/RECP2
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
      value={{ user, viewAsRole, loading, backupDoctorActive, hasReceptionPermission, signIn, signOut, setViewAsRole }}
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
