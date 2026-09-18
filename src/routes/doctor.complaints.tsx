import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PhoneCall } from "lucide-react";
import { DoctorShell } from "@/components/yhc/DoctorShell";
import { AuthGate, LoadingBlock, EmptyBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { fetchOpenComplaints, resolveComplaint } from "@/lib/db";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/doctor/complaints")({
  head: () => ({ meta: [{ title: "Complaint Calls — Doctor App" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["CASE_DR", "DOCTOR", "OWNER"]} permKey="complaints">
      <ComplaintsPage />
    </AuthGate>
  ),
});

function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Aaj";
  if (days === 1) return "1 din pehle";
  return `${days} din pehle`;
}

function ComplaintsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["open-complaints"],
    queryFn: fetchOpenComplaints,
  });
  const rows = data ?? [];
  const [drafts, setDrafts] = useState<Record<string, { clarified: string; answer: string }>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const resolve = async (id: string) => {
    const answer = (drafts[id]?.answer ?? "").trim();
    const clarified = (drafts[id]?.clarified ?? "").trim();
    if (!answer) {
      toast.error("Doctor ka jawab likho pehle");
      return;
    }
    setResolvingId(id);
    const res = await resolveComplaint(id, answer, user?.name, clarified);
    setResolvingId(null);
    if (!res.success) {
      toast.error("Save nahi hua: " + res.error);
      return;
    }
    toast.success("Complaint resolve ho gayi");
    qc.invalidateQueries({ queryKey: ["open-complaints"] });
  };

  return (
    <DoctorShell title="Complaint Calls" subtitle={`${rows.length} pending jawab ka intezaar`} nav="case">
      <p className="text-[11px] text-muted-foreground mb-3">
        Reception ne ye complaints register ki hain — patient se baat karke Doctor ka jawab yahan likh do, patient ki profile mein automatically date ke saath record ho jayega.
      </p>
      {isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <EmptyBlock label="Koi complaint pending nahi hai — sab jawab de diye gaye hain." />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.id} className="rounded-2xl bg-surface border border-destructive/40 p-3.5">
              <div className="flex items-center justify-between">
                <Link
                  to="/patient/$id"
                  params={{ id: r.patient_id }}
                  className="font-bold text-primary text-sm truncate underline"
                >
                  {r.patient?.name ?? "—"}
                </Link>
                <span className="shrink-0 rounded-full bg-destructive/15 text-destructive text-[11px] font-bold px-2 py-0.5">
                  {daysAgo(r.created_at)}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {r.patient?.patient_code} • {r.patient?.mobile}
              </div>
              <p className="text-sm mt-2 whitespace-pre-wrap">{r.note}</p>
              {r.created_by && <p className="text-[11px] text-muted-foreground mt-0.5">— {r.created_by} ne register ki</p>}

              <div className="mt-3 flex flex-col gap-1.5">
                <div className="flex gap-1.5">
                  {r.patient?.mobile && (
                    <a
                      href={`tel:${r.patient.mobile}`}
                      className="shrink-0 h-9 w-9 grid place-items-center rounded-full bg-primary text-primary-foreground"
                      aria-label="Call"
                    >
                      <PhoneCall className="h-4 w-4" />
                    </a>
                  )}
                  <input
                    value={drafts[r.id]?.clarified ?? ""}
                    onChange={(e) => setDrafts((s) => ({ ...s, [r.id]: { clarified: e.target.value, answer: s[r.id]?.answer ?? "" } }))}
                    placeholder="Patient ne actually kya bola (optional)..."
                    className="flex-1 min-w-0 rounded-lg bg-background border border-input px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex gap-1.5">
                  <input
                    value={drafts[r.id]?.answer ?? ""}
                    onChange={(e) => setDrafts((s) => ({ ...s, [r.id]: { clarified: s[r.id]?.clarified ?? "", answer: e.target.value } }))}
                    placeholder="Doctor ka jawab likho..."
                    className="flex-1 min-w-0 rounded-lg bg-background border border-input px-3 py-2 text-sm"
                  />
                  <button
                    onClick={() => resolve(r.id)}
                    disabled={resolvingId === r.id}
                    className="shrink-0 rounded-lg bg-success text-success-foreground px-4 py-2 text-sm font-bold disabled:opacity-50"
                  >
                    {resolvingId === r.id ? "..." : "Resolve"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DoctorShell>
  );
}
