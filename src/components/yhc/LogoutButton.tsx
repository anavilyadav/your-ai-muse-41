import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeDoctorSession } from "@/lib/yhc-doctor";
import { cn } from "@/lib/utils";

// Logout that still works when the app is stuck (Dr. Yadav, 30 Oct 2026:
// "logout ka button har jagah chahiye kyuki stuck ho jata hai"). A normal
// sign-out gets 4 seconds; then the local session is dropped anyway and the
// login page is loaded fresh, so a hung request can never trap anyone.
export function useForceLogout() {
  const { signOut } = useAuth();
  return async () => {
    try { writeDoctorSession(null); } catch {}
    try {
      await Promise.race([signOut(), new Promise((r) => setTimeout(r, 4000))]);
    } catch {}
    try { await supabase.auth.signOut({ scope: "local" }); } catch {}
    window.location.replace("/login");
  };
}

export function LogoutButton({ className, label = true }: { className?: string; label?: boolean }) {
  const logout = useForceLogout();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { setBusy(true); void logout(); }}
      disabled={busy}
      aria-label="Logout"
      title="Logout"
      className={cn(
        "h-9 rounded-full bg-white/10 hover:bg-white/20 text-xs font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-60",
        label ? "px-3" : "w-9",
        className,
      )}
    >
      <LogOut className="h-4 w-4" />
      {label && <span>{busy ? "…" : "Logout"}</span>}
    </button>
  );
}

// Shown on a full-screen "Loading…" / "Redirecting…" that lasts too long:
// a way out instead of a frozen screen.
export function StuckHelp({ after = 6000 }: { after?: number }) {
  const [show, setShow] = useState(false);
  const logout = useForceLogout();
  useEffect(() => {
    const t = setTimeout(() => setShow(true), after);
    return () => clearTimeout(t);
  }, [after]);
  if (!show) return null;
  return (
    <div className="mt-4 flex flex-col items-center gap-2 text-center">
      <div className="text-[12px] text-muted-foreground">Atak gaya lagta hai?</div>
      <div className="flex gap-2">
        <button onClick={() => void logout()} className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-bold inline-flex items-center gap-1">
          <LogOut className="h-3.5 w-3.5" /> Logout karo
        </button>
        <a href="/reset" className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-bold text-primary">App reset karo</a>
      </div>
    </div>
  );
}
