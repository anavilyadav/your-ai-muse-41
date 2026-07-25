import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth, useEffectiveRole } from "@/lib/auth";
import { roleHome } from "@/lib/supabase";

export const Route = createFileRoute("/doctor/")({
  head: () => ({ meta: [{ title: "Doctor — YHC" }, { name: "robots", content: "noindex" }] }),
  component: DoctorEntry,
});

function DoctorEntry() {
  const { user, loading, backupDoctorActive } = useAuth();
  // IMPORTANT: this must dispatch on the EFFECTIVE role (respects Owner's
  // "View as CASE_DR" preview), not the raw account role. Using user.role
  // directly here sent a previewing Owner to /doctor/rx, whose AuthGate then
  // saw effective role = CASE_DR (not allowed there) and bounced back to
  // /doctor — an infinite redirect loop that froze the screen on "Loading…"
  // the instant you opened the Case-DR preview.
  const role = useEffectiveRole();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (!user || !role) return void navigate({ to: "/login", replace: true });
    if (backupDoctorActive) return void navigate({ to: "/doctor/rx", replace: true });
    if (role === "DOCTOR" || role === "OWNER") return void navigate({ to: "/doctor/rx", replace: true });
    if (role === "CASE_DR") return void navigate({ to: "/doctor/case", replace: true });
    navigate({ to: roleHome(role), replace: true });
  }, [user, role, loading, backupDoctorActive, navigate]);

  return (
    <div className="min-h-screen w-full bg-background grid place-items-center">
      <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
    </div>
  );
}
