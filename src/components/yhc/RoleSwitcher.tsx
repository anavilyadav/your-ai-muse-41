import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Eye, ChevronDown, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { roleHome, type Role } from "@/lib/supabase";

const PREVIEW_ROLES: { role: Role; label: string }[] = [
  { role: "DOCTOR", label: "Doctor (Prescribing)" },
  { role: "CASE_DR", label: "Case-Taking Doctor" },
  { role: "PHARMA", label: "Pharmacy" },
  { role: "RECP1", label: "Reception" },
  { role: "CALLING", label: "Calling Team" },
];

/** Only renders anything for OWNER accounts. Lets Owner preview other role screens. */
export function RoleSwitcher() {
  const { user, viewAsRole, setViewAsRole } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  if (!user || user.role !== "OWNER") return null;

  const pick = (role: Role) => {
    setViewAsRole(role);
    setOpen(false);
    navigate({ to: roleHome(role) });
  };

  const exit = () => {
    setViewAsRole(null);
    navigate({ to: "/owner" });
  };

  if (viewAsRole) {
    return (
      <button
        onClick={exit}
        className="rounded-full bg-accent text-accent-foreground text-[11px] px-3 py-1.5 font-bold inline-flex items-center gap-1"
      >
        <X className="h-3.5 w-3.5" /> Exit preview
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-full bg-white/15 text-primary-foreground text-[11px] px-3 py-1.5 font-semibold inline-flex items-center gap-1"
      >
        <Eye className="h-3.5 w-3.5" /> View as <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-40 w-52 rounded-xl bg-surface border border-border shadow-lg overflow-hidden">
            {PREVIEW_ROLES.map((r) => (
              <button
                key={r.role}
                onClick={() => pick(r.role)}
                className="w-full text-left px-3.5 py-2.5 text-[12.5px] font-semibold text-primary hover:bg-accent/15 transition-colors"
              >
                {r.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Persistent banner shown across the app whenever Owner is previewing another role. */
export function ViewAsBanner() {
  const { user, viewAsRole, setViewAsRole } = useAuth();
  const navigate = useNavigate();
  if (!user || user.role !== "OWNER" || !viewAsRole) return null;
  const label = PREVIEW_ROLES.find((r) => r.role === viewAsRole)?.label ?? viewAsRole;
  return (
    <div className="sticky top-0 z-50 bg-accent text-accent-foreground text-[12px] font-bold py-1.5 px-3 flex items-center justify-center gap-2">
      <Eye className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">Owner preview: {label}</span>
      <button
        onClick={() => {
          setViewAsRole(null);
          navigate({ to: "/owner" });
        }}
        className="shrink-0 rounded-full bg-primary text-primary-foreground px-3 py-1 text-[11.5px] font-bold"
      >
        Owner pe wapas jao
      </button>
    </div>
  );
}

/** Banner for staff who currently have temporary Backup Doctor access. */
export function BackupDoctorBanner() {
  const { user, backupDoctorActive } = useAuth();
  if (!user || user.role === "OWNER" || !backupDoctorActive) return null;
  return (
    <div className="sticky top-0 z-50 bg-success text-success-foreground text-[12px] font-bold text-center py-1.5">
      🩺 Aapko temporary Backup Doctor access mila hai
    </div>
  );
}
