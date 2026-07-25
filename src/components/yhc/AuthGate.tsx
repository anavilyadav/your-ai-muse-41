import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth, useEffectiveRole } from "@/lib/auth";
import type { Role } from "@/lib/supabase";
import { roleHome } from "@/lib/supabase";

/**
 * Wraps role-restricted pages. Redirects to /login if not signed in,
 * or to the user's role home if their role is not in `allow`.
 * Optional `permKey` additionally checks the Owner's per-screen
 * RECP1/RECP2 ON/OFF permission toggles (Owner Control Centre).
 */
export function AuthGate({ allow, permKey, children }: { allow: Role[]; permKey?: string; children: ReactNode }) {
  const { user, loading, hasReceptionPermission } = useAuth();
  const role = useEffectiveRole();
  const navigate = useNavigate();

  const permOk = !permKey || hasReceptionPermission(permKey);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/login", replace: true });
      return;
    }
    if (role && (!allow.includes(role) || !permOk)) {
      navigate({ to: roleHome(role), replace: true });
    }
  }, [loading, user, role, allow, permOk, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen w-full bg-background grid place-items-center">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }
  if (role && (!allow.includes(role) || !permOk)) {
    return (
      <div className="min-h-screen w-full bg-background grid place-items-center">
        <div className="text-sm text-muted-foreground">Redirecting…</div>
      </div>
    );
  }
  return <>{children}</>;
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="py-16 text-center text-sm text-muted-foreground animate-pulse">{label}</div>
  );
}

export function EmptyBlock({ label }: { label: string }) {
  return <div className="py-12 text-center text-sm text-muted-foreground">{label}</div>;
}
