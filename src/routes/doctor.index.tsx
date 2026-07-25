import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { roleHome } from "@/lib/supabase";

export const Route = createFileRoute("/doctor/")({
  head: () => ({ meta: [{ title: "Doctor — YHC" }, { name: "robots", content: "noindex" }] }),
  component: DoctorEntry,
});

function DoctorEntry() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (!user) return void navigate({ to: "/login", replace: true });
    if (user.role === "DOCTOR" || user.role === "OWNER") return void navigate({ to: "/doctor/rx", replace: true });
    if (user.role === "CASE_DR") return void navigate({ to: "/doctor/case", replace: true });
    navigate({ to: roleHome(user.role), replace: true });
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen w-full bg-background grid place-items-center">
      <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
    </div>
  );
}
