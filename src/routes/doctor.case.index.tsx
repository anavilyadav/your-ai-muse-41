import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DoctorShell } from "@/components/yhc/DoctorShell";
import { AuthGate, LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { fetchTodayQueueCaseDR, fetchCaseDrLevels, updateCaseComplexity } from "@/lib/db";
import { useAuth, useEffectiveRole } from "@/lib/auth";
import { today } from "@/lib/supabase";
import { Lock, Sparkles } from "lucide-react";

export const Route = createFileRoute("/doctor/case/")({
  head: () => ({ meta: [{ title: "Case Board — Doctor App" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["CASE_DR", "OWNER"]}>
      <CaseBoardPage />
    </AuthGate>
  ),
});

const statusStyle: Record<string, string> = {
  Pending: "bg-accent/25 text-accent-foreground border-accent/50",
  "In Progress": "bg-primary/10 text-primary border-primary/30",
  Submitted: "bg-success/15 text-success border-success/40",
};

function mapStatus(s: string): "Pending" | "In Progress" | "Submitted" {
  if (s === "REGISTERED") return "Pending";
  if (s === "CASE_TAKING") return "In Progress";
  return "Submitted";
}

function CaseBoardPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const effectiveRole = useEffectiveRole();
  const branchScope = effectiveRole === "OWNER" ? undefined : user?.branch ?? undefined;
  const { data, isLoading } = useQuery({
    // A dedicated "casedr" segment, not just branchScope, is deliberate:
    // this fetcher returns CASE_DR_SAFE_PATIENT_FIELDS only (no mobile,
    // no address — Hidden Identity Mode), while every other role's
    // "today-queue" fetches full patient rows. Sharing a cache key with
    // those would risk this restricted view briefly rendering with a
    // full-PII cached entry (e.g. right after an Owner used "View as"),
    // or vice versa. The nested array still starts with "today-queue",
    // so existing invalidateQueries({queryKey: ["today-queue"]}) calls
    // elsewhere (register/pay/dispense/case-form/rx-consult) continue to
    // refresh this too.
    queryKey: ["today-queue", "casedr", branchScope ?? "all"],
    queryFn: () => fetchTodayQueueCaseDR(branchScope),
    refetchInterval: 15_000,
  });
  const { data: levels } = useQuery({ queryKey: ["case-dr-levels"], queryFn: fetchCaseDrLevels });

  const myLevel = (user && levels?.[user.id]) || "Senior"; // default Senior (full access) until Owner sets otherwise
  const isJunior = myLevel === "Junior";

  const allRows = (data ?? []).filter((r) =>
    ["REGISTERED", "CASE_TAKING", "WAITING_DOCTOR"].includes(r.visit_status),
  );
  const rows = isJunior ? allRows.filter((r: any) => (r.case_complexity ?? "Simple") === "Simple") : allRows;
  const hiddenForJunior = allRows.length - rows.length;
  const assigned = rows.length;
  const submitted = rows.filter((r) => r.visit_status === "WAITING_DOCTOR").length;
  const remaining = assigned - submitted;

  const markComplex = async (visitId: string, current: string) => {
    const next = current === "Complex" ? "Simple" : "Complex";
    const res = await updateCaseComplexity(visitId, next as "Simple" | "Complex");
    if (res.success) {
      qc.invalidateQueries({ queryKey: ["today-queue"] });
      toast.success(next === "Complex" ? "Complex mark kiya — sirf Senior Case-DR dekhenge" : "Simple mark kiya");
    } else {
      toast.error("Update nahi hua: " + res.error);
    }
  };

  return (
    <DoctorShell title="My Cases" subtitle="Contact details hidden" showLogout nav="case">
      <div className="grid grid-cols-3 gap-2">
        <Stat v={assigned} l="Assigned" />
        <Stat v={submitted} l="Submitted" tone="success" />
        <Stat v={remaining} l="Remaining" tone="accent" />
      </div>

      <div className="mt-3 rounded-xl bg-accent/20 border border-accent/40 p-3 text-[12px] text-primary flex gap-2">
        <Lock className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          Mobile aur contact details hidden hain. Name, age, gender visible. Fresh case lo — previous prescriptions
          nahi dikhengi.
        </span>
      </div>

      {isJunior && hiddenForJunior > 0 && (
        <div className="mt-2 rounded-xl bg-primary/10 border border-primary/30 p-3 text-[12px] text-primary flex gap-2">
          <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{hiddenForJunior} complex case(s) sirf Senior Case-DR ko dikh rahe hain — aapke level ke hisaab se.</span>
        </div>
      )}

      {isLoading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyBlock label="Koi case pending nahi." />
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((c: any) => {
            const status = mapStatus(c.visit_status);
            const clickable = status !== "Submitted";
            const complexity = c.case_complexity ?? "Simple";
            const daysWaiting = Math.max(0, Math.floor((Date.parse(today()) - Date.parse(c.visit_date)) / 86_400_000));
            return (
              <li key={c.id}>
                <div
                  className={
                    "rounded-2xl bg-surface border border-border p-3.5 shadow-sm transition " +
                    (clickable ? "hover:border-primary/40" : "opacity-60")
                  }
                >
                  <button
                    disabled={!clickable}
                    onClick={() => navigate({ to: "/doctor/case/form/$token", params: { token: c.id } })}
                    className={"w-full text-left " + (clickable ? "active:scale-[0.99]" : "cursor-not-allowed")}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-primary text-primary-foreground text-[11px] font-bold px-2.5 py-1">
                          {c.token_number ?? "—"}
                        </span>
                        <span className="font-bold text-[15px] text-primary">{c.patient?.name}</span>
                      </div>
                      <span className={"rounded-full text-[11px] font-bold px-2.5 py-1 border " + statusStyle[status]}>
                        {status}
                      </span>
                    </div>
                    <div className="text-[12px] text-muted-foreground mt-1.5 flex items-center gap-2 flex-wrap">
                      <span>{c.patient?.age ? `${c.patient.age}y` : "—"} • {c.patient?.gender ?? "—"}</span>
                      {daysWaiting > 0 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-destructive/10 text-destructive border-destructive/30">
                          {daysWaiting}d pending
                        </span>
                      )}
                    </div>
                    <div className="text-[13px] text-primary mt-0.5">{c.chief_complaint || "—"}</div>
                  </button>
                  {!isJunior && (
                    <button
                      onClick={() => markComplex(c.id, complexity)}
                      className={
                        "mt-2 rounded-full text-[10px] font-bold px-2.5 py-1 border " +
                        (complexity === "Complex"
                          ? "bg-destructive/15 text-destructive border-destructive/40"
                          : "bg-muted text-muted-foreground border-border")
                      }
                    >
                      {complexity === "Complex" ? "🔴 Complex — sirf Senior" : "Mark as Complex"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DoctorShell>
  );
}

function Stat({ v, l, tone }: { v: number | string; l: string; tone?: "success" | "accent" }) {
  return (
    <div className="rounded-xl bg-surface border border-border px-2 py-2.5 text-center">
      <div
        className={
          "text-base font-bold leading-tight " +
          (tone === "success" ? "text-success" : tone === "accent" ? "text-accent-foreground" : "text-primary")
        }
      >
        {v}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">{l}</div>
    </div>
  );
}
