import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, AlertTriangle, ChevronDown, ChevronRight, Users, UserX, CreditCard, Copy, Phone, Mail, Download, PhoneCall, EyeOff, RotateCcw } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { OWNER_NAV } from "./owner.index";
import { fetchDataQualityReport, fetchDismissedSharedMobiles, setSharedMobileDismissed, formatCardNumber, type DQPatientRef } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/data-quality")({
  head: () => ({ meta: [{ title: "Data Quality — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <DataQualityPage />
    </AuthGate>
  ),
});

function downloadCSV(rows: Record<string, string | number>[], filename: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function PatientChip({ p }: { p: DQPatientRef }) {
  // Owner reported the YHC-XXXX code shown here is useless for
  // cross-checking against the physical card register — they need the
  // real card (series-register-number) to go open the actual paper book.
  const card = formatCardNumber(p.card_series, p.card_register, p.card_number);
  return (
    <Link
      to="/patient/$id"
      params={{ id: p.id }}
      className="inline-flex items-center gap-1.5 rounded-full bg-background border border-border px-2.5 py-1 text-[12px] font-medium text-primary hover:border-accent"
    >
      {p.name || "(no name)"}
      <span className="text-muted-foreground">· {card ? `Card: ${card}` : "Card nahi hai"}</span>
    </Link>
  );
}

function Section({
  icon: Icon, title, hint, count, total, open, onToggle, children, onExport,
}: {
  icon: any; title: string; hint: string; count: number; total: number;
  open: boolean; onToggle: () => void; children: React.ReactNode; onExport?: () => void;
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
      <div className="w-full flex items-center gap-2.5 p-3.5">
        <button onClick={onToggle} className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
          <Icon className="h-4 w-4 text-destructive shrink-0" />
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-primary">{title}</div>
            <div className="text-[11px] text-muted-foreground">{hint}</div>
          </div>
        </button>
        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive text-[11px] font-bold px-2 py-1">
          {total}{total > count ? ` (${count} dikh rahe)` : ""}
        </span>
        {onExport && (
          <button onClick={onExport} title="CSV mein download karo" className="shrink-0 h-7 w-7 grid place-items-center rounded-full bg-background border border-border text-primary">
            <Download className="h-3.5 w-3.5" />
          </button>
        )}
        <button onClick={onToggle}>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        </button>
      </div>
      {open && <div className="border-t border-border p-3 space-y-2">{children}</div>}
    </div>
  );
}

function DataQualityPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["data-quality-report"], queryFn: fetchDataQualityReport });
  const dismissedQ = useQuery({ queryKey: ["dq-dismissed-shared-mobiles"], queryFn: fetchDismissedSharedMobiles });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((s) => ({ ...s, [k]: !s[k] }));
  const [dismissing, setDismissing] = useState<string | null>(null);

  const setDismissed = async (mobile: string, dismissed: boolean) => {
    setDismissing(mobile);
    try {
      await setSharedMobileDismissed(mobile, dismissed);
      await qc.invalidateQueries({ queryKey: ["dq-dismissed-shared-mobiles"] });
      toast.success(dismissed ? "Ignore kar diya — dubara nahi dikhega, jab chaho recheck kar sakte ho" : "Wapas active list mein aa gaya");
    } catch (e: any) {
      toast.error("Save nahi hua: " + (e?.message ?? e));
    } finally {
      setDismissing(null);
    }
  };

  if (q.isLoading) return <RoleShell wide title="Data Quality" nav={OWNER_NAV}><LoadingBlock /></RoleShell>;
  if (q.isError) return <RoleShell wide title="Data Quality" nav={OWNER_NAV}><ErrorBlock error={q.error} onRetry={() => q.refetch()} /></RoleShell>;

  const r = q.data!;
  // Some shared-mobile groups are genuinely unrelated patients (Dr.
  // Yadav's free camp — many share one organizer/family phone) with
  // nothing to fix. Dismissing one is reversible — it just moves the
  // group from the active list into its own "already reviewed" section
  // below, never deleted, always one tap from coming back.
  const dismissedSet = new Set(dismissedQ.data ?? []);
  const activeMobileGroups = r.shared_mobiles.filter((g) => !dismissedSet.has(g.mobile));
  const dismissedMobileGroups = r.shared_mobiles.filter((g) => dismissedSet.has(g.mobile));
  // Patient-level count, not group count — a shared-mobile "group" of 3
  // patients counts as 3 here, not 1, so this matches what the Owner
  // actually sees when they open each category (avoids the earlier bug
  // where 9 duplicate-mobile GROUPS covering 198 patients was reported as
  // "9 patient records"). Uses activeMobileGroups (not r.shared_mobiles),
  // so dismissed groups don't inflate "issues found" forever.
  const sharedMobilePatients = activeMobileGroups.reduce((s, g) => s + g.count, 0);
  const dupCardPatients = r.duplicate_cards.reduce((s, d) => s + d.count, 0);
  const dupPatientRecords = r.possible_duplicate_patients.reduce((s, d) => s + d.count, 0);
  const anyIssues = r.incomplete_names_total > 0 || activeMobileGroups.length > 0 || r.partial_card_total > 0
    || r.duplicate_cards.length > 0 || r.possible_duplicate_patients.length > 0 || r.invalid_mobile_total > 0 || r.invalid_email_total > 0;

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
            : `Neeche category-wise list hai — ${r.incomplete_names_total} adhoore naam, ${sharedMobilePatients} patients ek shared mobile number pe (${activeMobileGroups.length} groups), ${r.partial_card_total} adhoora card number, ${dupCardPatients} patients duplicate card number pe, ${dupPatientRecords} records same naam+mobile pe alag-alag ban gaye (${r.possible_duplicate_patients.length} groups). Har entry ko tap karke us patient ke profile pe jaakar theek karo (naam edit / card number update / merge).`}
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
          onExport={() => downloadCSV(r.incomplete_names.map((p) => ({ Name: p.name, Mobile: p.mobile ?? "", Card: formatCardNumber(p.card_series, p.card_register, p.card_number) ?? "", "Patient Code": p.patient_code ?? "" })), "adhoore_naam.csv")}
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
          count={activeMobileGroups.length} total={activeMobileGroups.length}
          open={!!open.mobiles} onToggle={() => toggle("mobiles")}
          onExport={() => downloadCSV(activeMobileGroups.flatMap((g) => g.patients.map((p) => ({ Mobile: g.mobile, Name: p.name, Card: formatCardNumber(p.card_series, p.card_register, p.card_number) ?? "", "Patient Code": p.patient_code ?? "" }))), "shared_mobile_numbers.csv")}
        >
          {activeMobileGroups.map((g) => (
            <div key={g.mobile} className="rounded-xl bg-background border border-border p-2.5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="text-[12px] font-bold text-primary inline-flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" /> {g.mobile} <span className="text-muted-foreground font-normal">({g.count} patients)</span>
                </div>
                <button
                  onClick={() => setDismissed(g.mobile, true)}
                  disabled={dismissing === g.mobile}
                  title="Ye log related nahi hain — list se hata do (recheck kar sakte ho baad mein)"
                  className="shrink-0 inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground text-[10px] font-bold px-2 py-1 disabled:opacity-60"
                >
                  <EyeOff className="h-3 w-3" /> Not related
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.patients.map((p) => <PatientChip key={p.id} p={p} />)}
              </div>
            </div>
          ))}
        </Section>

        {dismissedMobileGroups.length > 0 && (
          <div className="rounded-2xl bg-surface border border-border overflow-hidden">
            <button onClick={() => toggle("dismissedMobiles")} className="w-full flex items-center gap-2.5 p-3.5 text-left">
              <EyeOff className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-primary">Already reviewed — related nahi hai</div>
                <div className="text-[11px] text-muted-foreground">Ye groups "Not related" mark kiye ja chuke hain</div>
              </div>
              <span className="shrink-0 text-[11px] font-bold text-muted-foreground">{dismissedMobileGroups.length}</span>
              {open.dismissedMobiles ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
            </button>
            {open.dismissedMobiles && (
              <div className="border-t border-border p-3 space-y-2">
                {dismissedMobileGroups.map((g) => (
                  <div key={g.mobile} className="rounded-xl bg-background border border-border p-2.5 opacity-75">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="text-[12px] font-bold text-primary inline-flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5" /> {g.mobile} <span className="text-muted-foreground font-normal">({g.count} patients)</span>
                      </div>
                      <button
                        onClick={() => setDismissed(g.mobile, false)}
                        disabled={dismissing === g.mobile}
                        className="shrink-0 inline-flex items-center gap-1 rounded-full bg-accent/15 text-primary text-[10px] font-bold px-2 py-1 disabled:opacity-60"
                      >
                        <RotateCcw className="h-3 w-3" /> Recheck karo
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.patients.map((p) => <PatientChip key={p.id} p={p} />)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <Section
          icon={CreditCard} title="Adhoora card number" hint="Series/Register/Number teeno bharna zaroori hai"
          count={r.partial_card.length} total={r.partial_card_total}
          open={!!open.partialCard} onToggle={() => toggle("partialCard")}
          onExport={() => downloadCSV(r.partial_card.map((p) => ({ Name: p.name, "Patient Code": p.patient_code ?? "", Card: formatCardNumber(p.card_series, p.card_register, p.card_number) ?? "" })), "adhoora_card_number.csv")}
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
          onExport={() => downloadCSV(r.duplicate_cards.flatMap((g) => g.patients.map((p) => ({ Card: formatCardNumber(g.card_series, g.card_register, g.card_number) ?? "", Name: p.name, "Patient Code": p.patient_code ?? "" }))), "duplicate_card_numbers.csv")}
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
          icon={Copy} title="Ek hi naam + mobile, alag patient records" hint="Card number alag-alag hai — shayad ek hi patient galti se dobara ban gaya, profile khol ke Merge karo"
          count={r.possible_duplicate_patients.length} total={r.possible_duplicate_patients_total}
          open={!!open.dupPatients} onToggle={() => toggle("dupPatients")}
          onExport={() => downloadCSV(r.possible_duplicate_patients.flatMap((g) => g.patients.map((p) => ({ Mobile: g.mobile, Name: p.name, Card: formatCardNumber(p.card_series, p.card_register, p.card_number) ?? "", "Patient Code": p.patient_code ?? "" }))), "possible_duplicate_patients.csv")}
        >
          {r.possible_duplicate_patients.map((g) => (
            <div key={`${g.name}-${g.mobile}`} className="rounded-xl bg-background border border-border p-2.5">
              <div className="text-[12px] font-bold text-primary mb-1.5">
                {g.name} · {g.mobile} <span className="text-muted-foreground font-normal">({g.count} records)</span>
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
          onExport={() => downloadCSV(r.invalid_mobile.map((p) => ({ Name: p.name, Mobile: p.mobile ?? "", Card: formatCardNumber(p.card_series, p.card_register, p.card_number) ?? "", "Patient Code": p.patient_code ?? "" })), "galat_mobile_number.csv")}
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
          onExport={() => downloadCSV(r.invalid_email.map((p) => ({ Name: p.name, Email: p.email ?? "", Card: formatCardNumber(p.card_series, p.card_register, p.card_number) ?? "", "Patient Code": p.patient_code ?? "" })), "galat_email.csv")}
        >
          {r.invalid_email.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2">
              <PatientChip p={p} />
              <span className="text-[11px] text-destructive shrink-0">{p.email}</span>
            </div>
          ))}
        </Section>
      </div>

      {/* Separate from the "mistakes" list above on purpose — an unconfirmed
          number isn't a data-entry error, it's a verification backlog that
          starts at ~every bulk-imported patient (mobile_confirmed/
          whatsapp_confirmed both default false). Folding its count into
          `anyIssues` above would make this page permanently read "issues
          found" even once every real mistake is fixed. */}
      {r.unconfirmed_numbers_total > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1 mb-1.5">
            Ongoing — patient se baat hote hi confirm karte jao
          </div>
          <Section
            icon={PhoneCall} title="Number confirm nahi hai" hint="Calling ya WhatsApp number kabhi patient se verify nahi hua"
            count={r.unconfirmed_numbers.length} total={r.unconfirmed_numbers_total}
            open={!!open.unconfirmed} onToggle={() => toggle("unconfirmed")}
            onExport={() => downloadCSV(r.unconfirmed_numbers.map((p) => ({
              Name: p.name, Mobile: p.mobile ?? "", Card: formatCardNumber(p.card_series, p.card_register, p.card_number) ?? "",
              "Mobile Confirmed": p.mobile_confirmed ? "Yes" : "No",
              "WhatsApp Confirmed": p.has_distinct_whatsapp ? (p.whatsapp_confirmed ? "Yes" : "No") : "N/A (same as mobile)",
            })), "unconfirmed_numbers.csv")}
          >
            {r.unconfirmed_numbers.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2">
                <PatientChip p={p} />
                <span className="text-[10px] text-muted-foreground shrink-0 text-right">
                  {!p.mobile_confirmed && <div>Mobile ⚠</div>}
                  {p.has_distinct_whatsapp && !p.whatsapp_confirmed && <div>WhatsApp ⚠</div>}
                </span>
              </div>
            ))}
          </Section>
        </div>
      )}
    </RoleShell>
  );
}
