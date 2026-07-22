import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, type AppUser, type Role } from "./supabase";

interface AuthCtx {
  user: AppUser | null;
  viewAsRole: Role | null; // OWNER can preview other roles
  loading: boolean;
  signIn: (mobile: string, pin: string) => Promise<string | null>; // null = ok, else error msg
  signOut: () => Promise<void>;
  setViewAsRole: (r: Role | null) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

const LS_VIEW = "yhc-viewas";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewAsRole, setViewAsRoleState] = useState<Role | null>(null);

  const loadUser = async (uid: string) => {
    const { data, error } = await supabase
      .from("users")
      .select("id,name,mobile,role,branch")
      .eq("id", uid)
      .maybeSingle();
    if (error || !data) return null;
    return data as AppUser;
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      if (data.session?.user) {
        const u = await loadUser(data.session.user.id);
        if (mounted) setUser(u);
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
      } else {
        setUser(null);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (mobile: string, pin: string) => {
    const cleaned = mobile.replace(/\D/g, "");
    if (cleaned.length !== 10 || pin.length < 4) return "Mobile ya PIN galat hai";
    const email = `${cleaned}@yhcos.in`;
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

  return (
    <Ctx.Provider value={{ user, viewAsRole, loading, signIn, signOut, setViewAsRole }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be inside AuthProvider");
  return c;
}

/** Effective role: owner can view as another role. */
export function useEffectiveRole(): Role | null {
  const { user, viewAsRole } = useAuth();
  if (!user) return null;
  if (user.role === "OWNER" && viewAsRole) return viewAsRole;
  return user.role;
}
