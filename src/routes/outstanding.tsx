import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Phone, MessageCircle, IndianRupee } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate, LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { fetchOutstandingPatients, branchLabel } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/outstanding")({
  head: () => ({ meta: [{ title: "Outstanding Dues — YHC" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["RECP1", "RECP2", "OWNER"]}>
      <OutstandingPage />
    </AuthGate>
  ),
});

function OutstandingPage() {
  const { data, isLoading } = useQuery({ queryKey: ["outstanding"], queryFn: fetchOutstandingPatients });
  const rows = (data ?? []) as any[];
  const total = rows.reduce((s, r) => s + Number(r.current_balance ?? 0), 0);

  return (
    <MobileShell title="Outstanding Dues" subtitle="Follow up for pending payments" showBack>
      <div className="rounded-2xl bg-primary text-primary-foreground p-4 flex items-center justify-between">
        <div>
          <div className="text-[12px] text-primary-foreground/65">Total Outstanding</div>
          <div className="text-2xl font-extrabold text-accent mt-0.5">₹{total.toLocaleString("en-IN")}</div>
        </div>
        <div className="text-right">
          <div className="text-[12px] text-primary-foreground/65">Patients</div>
          <div className="text-2xl font-extrabold">{rows.length}</div>
        </div>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyBlock label="Koi outstanding balance nahi hai — sab clear hai." />
      ) : (
        <ul className="mt-4 space-y-2.5">
          {rows.map((p: any) => (
            <li key={p.id} className="rounded-xl bg-surface border border-border border-l-4 border-l-destructive p-3">
              <div className="flex items-center justify-between">
                <Link to="/patient/$id" params={{ id: p.id }} className="min-w-0 flex-1">
                  <div className="font-semibold text-sm text-primary truncate">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {p.patient_code ?? "—"} • {branchLabel(p.branch)}
                  </div>
                  <div className="flex items-center gap-1 text-[13px] font-bold text-destructive mt-1">
                    <IndianRupee className="h-3.5 w-3.5" /> {Number(p.current_balance).toLocaleString("en-IN")}
                  </div>
                </Link>
                <div className="flex gap-1.5 shrink-0 ml-2">
                  {p.mobile && (
                    <>
                      <a href={`tel:${p.mobile}`} className="h-8 w-8 grid place-items-center rounded-full bg-primary text-primary-foreground">
                        <Phone className="h-4 w-4" />
                      </a>
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={`https://wa.me/91${p.mobile}?text=${encodeURIComponent(`Namaste ${p.name} ji! Aapka ₹${Number(p.current_balance).toLocaleString("en-IN")} balance pending hai YHC mein. Kripya jald clear kar dein. Dhanyawad — YHC Jaipur`)}`}
                        className="h-8 w-8 grid place-items-center rounded-full bg-success text-success-foreground"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </MobileShell>
  );
}
