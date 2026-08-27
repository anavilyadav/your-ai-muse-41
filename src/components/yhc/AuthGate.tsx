import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth, useEffectiveRole } from "@/lib/auth";
import type { Role } from "@/lib/supabase";
import { roleHome } from "@/lib/supabase";
import { readErrorMessage } from "@/lib/db";

/**
 * Wraps role-restricted pages. Redirects to /login if not signed in,
 * or to the user's role home if their role is not in `allow`.
 * Optional `permKey` additionally checks the Owner's per-screen
 * RECP1/RECP2 ON/OFF permission toggles (Owner Control Centre).
 */
export function AuthGate({ allow, permKey, children }: { allow: Role[]; permKey?: string; children: ReactNode }) {
  const { user, loading, profileLoadFailed, retryLoadProfile, hasReceptionPermission } = useAuth();
  const role = useEffectiveRole();
  const navigate = useNavigate();

  const permOk = !permKey || hasReceptionPermission(permKey);
  // `allow` is passed as a fresh array literal on every parent render
  // (e.g. allow={["CASE_DR","OWNER"]}). Depending on the array reference
  // itself would re-run this effect on every render; depending on its
  // contents instead keeps it stable.
  const allowKey = allow.join(",");

  useEffect(() => {
    if (loading) return;
    // Phase 1 #7: a real session that just failed to load OUR profile
    // (slow network — see auth.tsx) must NOT bounce to /login. That was
    // the "login karke turant bounce" bug: staff genuinely signs in,
    // network is slow, profile fetch times out, and this effect used to
    // treat that identically to "never logged in" and kick them straight
    // back to the login screen. Now it just waits — the retry UI below
    // handles it, and /login is only for a confirmed absence of session.
    if (profileLoadFailed) return;
    if (!user) {
      navigate({ to: "/login", replace: true });
      return;
    }
    if (role && (!allow.includes(role) || !permOk)) {
      navigate({ to: roleHome(role), replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, profileLoadFailed, role, allowKey, permOk, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-background grid place-items-center">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }
  if (profileLoadFailed) {
    return (
      <div className="min-h-screen w-full bg-background grid place-items-center px-6">
        <div className="text-center max-w-xs">
          <div className="text-sm font-semibold text-foreground mb-1">Connection slow hai</div>
          <div className="text-xs text-muted-foreground mb-4">Login ho gaya hai, lekin profile load nahi ho paya — network check karke dobara try karo.</div>
          <button
            onClick={retryLoadProfile}
            className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold"
          >
            Dobara try karo
          </button>
        </div>
      </div>
    );
  }
  if (!user) {
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

// Shown when a read FAILED — deliberately distinct from EmptyBlock so a
// permission/network failure can never be mistaken for "no records".
export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="my-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-center"
    >
      <p className="text-sm font-semibold text-destructive">Load nahi ho paaya</p>
      <p className="mt-1 text-xs text-muted-foreground">{readErrorMessage(error)}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg border border-destructive/40 px-4 py-1.5 text-xs font-semibold text-destructive"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
