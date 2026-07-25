import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DoctorShell } from "@/components/yhc/DoctorShell";
import { AuthGate, LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { fetchTodayQueue } from "@/lib/db";
import { Lock } from "lucide-react";

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
  const { data, isLoading } = useQuery({
    queryKey: ["today-queue"],
    queryFn: fetchTodayQueue,
    refetchInterval: 15_000,
  });
  const rows = (data ?? []).filter((r) =>
    ["REGISTERED", "CASE_TAKING", "WAITING_DOCTOR"].includes(r.visit_status),
  );
  const assigned = rows.length;
  const submitted = rows.filter((r) => r.visit_status === "WAITING_DOCTOR").length;
  const remaining = assigned - submitted;

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

      {isLoading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyBlock label="Koi case pending nahi." />
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((c) => {
            const status = mapStatus(c.visit_status);
            const clickable = status !== "Submitted";
            return (
              <li key={c.id}>
                <button
                  disabled={!clickable}
                  onClick={() => navigate({ to: "/doctor/case/form/$token", params: { token: c.id } })}
                  className={
                    "w-full text-left rounded-2xl bg-surface border border-border p-3.5 shadow-sm transition " +
                    (clickable ? "hover:border-primary/40 active:scale-[0.99]" : "opacity-60 cursor-not-allowed")
                  }
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
                  <div className="text-[12px] text-muted-foreground mt-1.5">
                    {c.patient?.age ? `${c.patient.age}y` : "—"} • {c.patient?.gender ?? "—"}
                  </div>
                  <div className="text-[13px] text-primary mt-0.5">{c.chief_complaint || "—"}</div>
                </button>
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
