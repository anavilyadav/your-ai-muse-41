import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, AlertTriangle, ChevronDown, ChevronRight, Users, UserX, CreditCard, Copy, Phone, Mail } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { OWNER_NAV } from "./owner.index";
import { fetchDataQualityReport, formatCardNumber, type DQPatientRef } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/data-quality")({
  head: () => ({ meta: [{ title: "Data Quality — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <DataQualityPage />
    </AuthGate>
  ),
});

function PatientChip({ p }: { p: DQPatientRef }) {
  return (
    <Link
      to="/patient/$id"
      params={{ id: p.id }}
      className="inline-flex items-center gap-1.5 rounded-full bg-background border border-border px-2.5 py-1 text-[12px] font-medium text-primary hover:border-accent"
    >
      {p.name || "(no name)"}
      {p.patient_code && <span className="text-muted-foreground">· {p.patient_code}</span>}
    </Link>
  );
}

function Section({
  icon: Icon, title, hint, count, total, open, onToggle, children,
}: {
  icon: any; title: string; hint: string; count: number; total: number;
  open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  if (total === 0) {
    return (
      <div className="rounded-2xl bg-surface border border-border p-3.5 flex items-center gap-2.5 opacity-60">
        <Icon className="h-4 w-4 text-success shrink-0" />
        <div className="text-[13px] text-primary font-medium">{title}</div>
        <span className="ml-auto text-[11px] text-success font-bold">0</span>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-surface border border-destructive/30 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-2.5 p-3.5 text-left">
        <Icon className="h-4 w-4 text-destructive shrink-0" />
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-primary">{title}</div>
          <div className="text-[11px] text-muted-foreground">{hint}</div>
        </div>
        <span className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive text-[11px] font-bold px-2 py-1">
          {total}{total > count ? ` (${count} dikh rahe)` : ""}
        </span>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {open && <div className="border-t border-border p-3 space-y-2">{children}</div>}
    </div>
  );
}

function DataQualityPage() {
  const q = useQuery({ queryKey: ["data-quality-report"], queryFn: fetchDataQualityReport });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((s) => ({ ...s, [k]: !s[k] }));

  if (q.isLoading) return <RoleShell wide title="Data Quality" nav={OWNER_NAV}><LoadingBlock /></RoleShell>;
  if (q.isError) return <RoleShell wide title="Data Quality" nav={OWNER_NAV}><ErrorBlock error={q.error} onRetry={() => q.refetch()} /></RoleShell>;

  const r = q.data!;
  // Patient-level count, not group count — a shared-mobile "group" of 3
  // patients counts as 3 here, not 1, so this matches what the Owner
  // actually sees when they open each category (avoids the earlier bug
  // where 9 duplicate-mobile GROUPS covering 198 patients was reported as
  // "9 patient records").
  const sharedMobilePatients = r.shared_mobiles.reduce((s, g) => s + g.count, 0);
  const dupCardPatients = r.duplicate_cards.reduce((s, d) => s + d.count, 0);
  const anyIssues = r.incomplete_names_total > 0 || r.shared_mobiles_total > 0 || r.partial_card_total > 0
    || r.duplicate_cards.length > 0 || r.invalid_mobile_total > 0 || r.invalid_email_total > 0;

  return (
    <RoleShell wide title="Data Quality" subtitle="Bulk import se pehle saaf karo" nav={OWNER_NAV}>
      <div className={cn(
        "rounded-2xl p-3.5 flex items-start gap-2 mb-3",
        !anyIssues ? "bg-success/10 text-success" : "bg-primary text-primary-foreground",
      )}>
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <span className="text-[12px]">
          {!anyIssues
            ? "Koi data-quality mistake nahi mili — abhi ke patients records saaf hain."
            : `Neeche category-wise list hai — ${r.incomplete_names_total} adhoore naam, ${sharedMobilePatients} patients ek shared mobile number pe (${r.shared_mobiles_total} groups), ${r.partial_card_total} adhoora card number, ${dupCardPatients} patients duplicate card number pe. Har entry ko tap karke us patient ke profile pe jaakar theek karo (naam edit / card number update / merge).`}
        </span>
      </div>

      <div className="flex items-center justify-between mb-3 px-0.5">
        <div className="text-[11px] text-muted-foreground">
          Live check — {new Date(r.generated_at).toLocaleString("en-IN")}
        </div>
        <button
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="inline-flex items-center gap-1.5 rounded-full bg-surface border border-border px-3 py-1.5 text-[11px] font-bold text-primary disabled:opacity-60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", q.isFetching && "animate-spin")} /> Refresh
        </button>
      </div>

      <div className="space-y-2.5">
        <Section
          icon={UserX} title="Adhoora naam" hint="Poora naam nahi hai (ek hi word)"
          count={r.incomplete_names.length} total={r.incomplete_names_total}
          open={!!open.names} onToggle={() => toggle("names")}
        >
          {r.incomplete_names.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2">
              <PatientChip p={p} />
              {p.mobile && <span className="text-[11px] text-muted-foreground shrink-0">{p.mobile}</span>}
            </div>
          ))}
        </Section>

        <Section
          icon={Users} title="Ek mobile number, kai patients" hint="Family ho sakti hai — ya galat entry, check karo"
          count={r.shared_mobiles.length} total={r.shared_mobiles_total}
          open={!!open.mobiles} onToggle={() => toggle("mobiles")}
        >
          {r.shared_mobiles.map((g) => (
            <div key={g.mobile} className="rounded-xl bg-background border border-border p-2.5">
              <div className="text-[12px] font-bold text-primary mb-1.5 inline-flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" /> {g.mobile} <span className="text-muted-foreground font-normal">({g.count} patients)</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.patients.map((p) => <PatientChip key={p.id} p={p} />)}
              </div>
            </div>
          ))}
        </Section>

        <Section
          icon={CreditCard} title="Adhoora card number" hint="Series/Register/Number teeno bharna zaroori hai"
          count={r.partial_card.length} total={r.partial_card_total}
          open={!!open.partialCard} onToggle={() => toggle("partialCard")}
        >
          {r.partial_card.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2">
              <PatientChip p={p} />
              <span className="text-[11px] text-muted-foreground shrink-0">
                {formatCardNumber(p.card_series, p.card_register, p.card_number) || "(khaali)"}
              </span>
            </div>
          ))}
        </Section>

        <Section
          icon={Copy} title="Ek hi card number, kai patients" hint="Almost hamesha galat entry hoti hai"
          count={r.duplicate_cards.length} total={r.duplicate_cards.reduce((s, d) => s + d.count, 0)}
          open={!!open.dupCard} onToggle={() => toggle("dupCard")}
        >
          {r.duplicate_cards.map((g) => (
            <div key={`${g.card_series}-${g.card_register}-${g.card_number}`} className="rounded-xl bg-background border border-border p-2.5">
              <div className="text-[12px] font-bold text-primary mb-1.5">
                Card {formatCardNumber(g.card_series, g.card_register, g.card_number)} <span className="text-muted-foreground font-normal">({g.count} patients)</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.patients.map((p) => <PatientChip key={p.id} p={p} />)}
              </div>
            </div>
          ))}
        </Section>

        <Section
          icon={Phone} title="Galat mobile number" hint="10-digit number nahi hai ya khaali hai"
          count={r.invalid_mobile.length} total={r.invalid_mobile_total}
          open={!!open.badMobile} onToggle={() => toggle("badMobile")}
        >
          {r.invalid_mobile.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2">
              <PatientChip p={p} />
              <span className="text-[11px] text-destructive shrink-0">{p.mobile || "(khaali)"}</span>
            </div>
          ))}
        </Section>

        <Section
          icon={Mail} title="Galat email" hint="Email format sahi nahi hai"
          count={r.invalid_email.length} total={r.invalid_email_total}
          open={!!open.badEmail} onToggle={() => toggle("badEmail")}
        >
          {r.invalid_email.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2">
              <PatientChip p={p} />
              <span className="text-[11px] text-destructive shrink-0">{p.email}</span>
            </div>
          ))}
        </Section>
      </div>
    </RoleShell>
  );
}
