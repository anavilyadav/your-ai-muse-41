import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, X } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock } from "@/components/yhc/AuthGate";
import { fetchSettings, upsertSetting, fetchStaff, fetchFeeMaster, saveFeeMaster, FEE_LABELS, DEFAULT_FEE_MASTER, type FeeMaster, fetchFeeRules, saveFeeRules, DEFAULT_FEE_RULES, type FeeRule, type FeeRuleAppliesTo, fetchNextVisitOptions, saveNextVisitOptions, DEFAULT_NEXT_VISIT_OPTIONS, type NextVisitOption, fetchSlxInstructions, saveSlxInstructions, DEFAULT_SLX_INSTRUCTIONS } from "@/lib/db";
import type { BackupDoctorConfig } from "@/lib/auth";
import { RECEPTION_SCREENS, RECEPTION_FEATURES } from "@/lib/auth";
import { OWNER_NAV } from "./owner.index";
import { cn } from "@/lib/utils";


export const Route = createFileRoute("/owner/control")({
  head: () => ({ meta: [{ title: "Control Centre — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <ControlPage />
    </AuthGate>
  ),
});

function BackupDoctorModal({ onClose }: { onClose: () => void }) {
  const { data: staff } = useQuery({ queryKey: ["owner-staff"], queryFn: fetchStaff });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const existing: BackupDoctorConfig | null = (() => {
    const row = (settings ?? []).find((r: any) => r.key === "backup_doctor_config");
    try {
      return row?.value ? JSON.parse(row.value) : null;
    } catch {
      return null;
    }
  })();

  const eligibleStaff = ((staff ?? []) as any[]).filter((s) => s.role !== "OWNER" && s.role !== "DOCTOR");
  const [userId, setUserId] = useState(existing?.userId ?? "");
  const [start, setStart] = useState(existing?.start?.slice(0, 16) ?? "");
  const [end, setEnd] = useState(existing?.end?.slice(0, 16) ?? "");
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const save = async (enabled: boolean) => {
    if (enabled && (!userId || !start || !end)) {
      toast.error("Staff, start aur end time zaroori hai");
      return;
    }
    setSaving(true);
    const cfg: BackupDoctorConfig = {
      userId,
      start: start ? new Date(start).toISOString() : "",
      end: end ? new Date(end).toISOString() : "",
      enabled,
    };
    try {
      await upsertSetting("backup_doctor_config", JSON.stringify(cfg));
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success(enabled ? "Backup doctor access ON kar diya" : "Backup doctor access OFF kar diya");
      if (!enabled) onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Save nahi hua");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-extrabold text-primary text-lg">Backup Doctor Access</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-[12px] text-muted-foreground mb-3">
          Chuni hui staff ko sirf is time-window ke andar hi temporary Doctor-app access milega, uske baad khud-ba-khud hat jaayega.
        </p>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Staff member</label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            >
              <option value="">— Select —</option>
              {eligibleStaff.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Start</label>
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">End</label>
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" />
          </div>
          {existing?.enabled && (
            <button onClick={() => save(false)} disabled={saving} className="w-full rounded-full bg-destructive text-destructive-foreground font-bold py-3 text-sm disabled:opacity-50">
              Turn OFF now
            </button>
          )}
          <button onClick={() => save(true)} disabled={saving} className="w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Saving…" : existing?.enabled ? "Update window" : "Activate for this window"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReceptionPermissionsGrid({
  settings,
  items,
  title,
  helpText,
}: {
  settings: any[];
  items: { key: string; label: string }[];
  title: string;
  helpText: string;
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const isOn = (role: "RECP1" | "RECP2", key: string) => {
    const row = settings.find((r: any) => r.key === `recp_perm:${role}:${key}`);
    return row ? (row.value === "true" || row.value === true) : true; // default ON
  };

  const toggle = async (role: "RECP1" | "RECP2", key: string) => {
    const k = `recp_perm:${role}:${key}`;
    const next = !isOn(role, key);
    setPending(k);
    try {
      await upsertSetting(k, String(next));
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Save nahi hua");
    }
    setPending(null);
  };

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </div>
      <div className="rounded-2xl bg-surface border border-border overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto] bg-primary text-primary-foreground text-[11px] font-bold px-3 py-2">
          <span>Screen</span>
          <span className="w-12 text-center">RECP1</span>
          <span className="w-12 text-center">RECP2</span>
        </div>
        {items.map((s, i) => (
          <div
            key={s.key}
            className={cn(
              "grid grid-cols-[1fr_auto_auto] items-center px-3 py-2.5",
              i < items.length - 1 && "border-b border-border",
            )}
          >
            <span className="text-[13px] text-primary truncate pr-2">{s.label}</span>
            {(["RECP1", "RECP2"] as const).map((role) => {
              const on = isOn(role, s.key);
              const k = `recp_perm:${role}:${s.key}`;
              return (
                <button
                  key={role}
                  onClick={() => toggle(role, s.key)}
                  disabled={pending === k}
                  className={cn(
                    "w-12 flex justify-center",
                  )}
                >
                  <span
                    className={cn(
                      "relative h-5 w-9 rounded-full transition inline-block",
                      on ? "bg-success" : "bg-border",
                      pending === k && "opacity-50",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                        on ? "left-[18px]" : "left-0.5",
                      )}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        {helpText}
      </p>
    </div>
  );
}

function JustDialToggle({ settings }: { settings: any[] }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const row = settings.find((r: any) => r.key === "justdial_webhook_enabled");
  const on = row ? row.value === "true" : true; // default ON once deployed

  const toggle = async () => {
    setPending(true);
    try {
      await upsertSetting("justdial_webhook_enabled", String(!on));
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Save nahi hua");
    }
    setPending(false);
  };

  return (
    <div className="rounded-2xl bg-surface border border-border p-3.5 flex items-center justify-between">
      <div>
        <div className="text-sm font-semibold text-primary">JustDial Auto-Lead + Welcome Message</div>
        <div className="text-[11px] text-muted-foreground">Naya JustDial lead aate hi automatic WhatsApp jaye</div>
      </div>
      <button onClick={toggle} disabled={pending} className={cn(pending && "opacity-50")}>
        <span className={cn("relative h-5 w-9 rounded-full transition inline-block", on ? "bg-success" : "bg-border")}>
          <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", on ? "left-[18px]" : "left-0.5")} />
        </span>
      </button>
    </div>
  );
}

// The 14 clinic-ops / feature-module / privacy / payment toggles that used
// to live here were removed: they wrote to `settings` but no code path
// anywhere in the app ever read those keys, so flipping them did nothing.
// On checking, most of them actually correspond to real features that DO
// exist and work — they just live on their own dedicated screen rather
// than being gated by a Control Centre switch (Lead CRM, Follow-up CRM,
// WhatsApp, Delivery/Courier, Hidden Identity, Case-DR Junior/Senior
// access, Partial payment, Advance payment). "Other Modules" below links
// to those directly. Only 3 of the original 14 are genuinely not built
// yet (Online Booking, Home Visits, Marketing/GIOS) — those are listed
// under "Planned", clearly separate from working links, no toggle switch.

// TASK 4 — Fee Master. Reception's Payment screen prefills from these, so
// a fee change is one edit here instead of retraining staff.
function FeeMasterCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["fee-master"], queryFn: fetchFeeMaster });
  const fees = data ?? DEFAULT_FEE_MASTER;
  const [draft, setDraft] = useState<FeeMaster | null>(null);
  const [saving, setSaving] = useState(false);
  const current = draft ?? fees;

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await saveFeeMaster(draft);
      qc.invalidateQueries({ queryKey: ["fee-master"] });
      setDraft(null);
      toast.success("Fees update ho gayi");
    } catch (e: any) {
      toast.error(e?.message ?? "Save nahi hua");
    }
    setSaving(false);
  };

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
        Fee Master — Payment screen ka default amount
      </div>
      <div className="rounded-2xl bg-surface border border-border p-3.5 space-y-2.5">
        {(Object.keys(FEE_LABELS) as (keyof FeeMaster)[]).map((k) => (
          <div key={k} className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-primary">{FEE_LABELS[k]}</span>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">₹</span>
              <input
                inputMode="numeric"
                value={current[k] || ""}
                onChange={(e) =>
                  setDraft({ ...current, [k]: Number(e.target.value.replace(/\D/g, "")) || 0 })
                }
                className="w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-right"
              />
            </div>
          </div>
        ))}
        {draft && (
          <button
            onClick={save}
            disabled={saving || Object.values(draft).some((v) => !v || v <= 0)}
            className="w-full rounded-full bg-accent text-accent-foreground font-bold py-2.5 text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Fees"}
          </button>
        )}
        <p className="text-[11px] text-muted-foreground">
          Reception yahi amount prefill dekhegi — concession dena ho to wahi edit kar sakti hai.
        </p>
      </div>
    </div>
  );
}

// Request (03 Aug 2026): the 3 fixed amounts above weren't enough — the
// re-case surcharge was a hidden hard-coded ₹1000 with no screen to see
// or change it, and there was no way to add a genuinely new rule at all.
// This is a real list now: Owner can add a rule, pick who it applies to
// from a dropdown (so the Payment screen can still apply it
// automatically), and remove any rule including the seeded re-case one.
const APPLIES_TO_OPTIONS: { value: FeeRuleAppliesTo; label: string }[] = [
  { value: "NEW", label: "Sirf New Case" },
  { value: "FOLLOWUP", label: "Sirf Follow-up" },
  { value: "ONLINE", label: "Sirf Online" },
  { value: "ALL", label: "Sabhi visit types" },
];

function FeeRulesCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["fee-rules"], queryFn: fetchFeeRules });
  const saved = data ?? DEFAULT_FEE_RULES;
  const [draft, setDraft] = useState<FeeRule[] | null>(null);
  const [saving, setSaving] = useState(false);
  const rules = draft ?? saved;

  const update = (id: string, patch: Partial<FeeRule>) => {
    setDraft(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addRule = () => {
    setDraft([
      ...rules,
      { id: crypto.randomUUID(), key: "CUSTOM", label: "", amount: 0, appliesTo: "ALL" },
    ]);
  };

  const removeRule = (id: string) => {
    setDraft(rules.filter((r) => r.id !== id));
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await saveFeeRules(draft);
      qc.invalidateQueries({ queryKey: ["fee-rules"] });
      setDraft(null);
      toast.success("Fee rules update ho gaye");
    } catch (e: any) {
      toast.error(e?.message ?? "Save nahi hua");
    }
    setSaving(false);
  };

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
        Extra Fee Rules — surcharge ya discount, koi bhi visit type pe
      </div>
      <div className="rounded-2xl bg-surface border border-border p-3.5 space-y-3">
        {rules.length === 0 && (
          <p className="text-[12px] text-muted-foreground">Koi extra rule nahi hai. Neeche se add karo.</p>
        )}
        {rules.map((r) => (
          <div key={r.id} className="rounded-xl bg-background border border-border p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <input
                placeholder="Rule ka naam (jaise: Re-case Surcharge)"
                value={r.label}
                onChange={(e) => update(r.id, { label: e.target.value })}
                className="flex-1 min-w-0 rounded-lg border border-border bg-surface px-2.5 py-2 text-[13px]"
              />
              <button
                type="button"
                onClick={() => removeRule(r.id)}
                className="shrink-0 h-8 w-8 grid place-items-center rounded-full bg-destructive/10 text-destructive"
                aria-label="Rule hatao"
                title="Rule hatao"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-2">
                <span className="text-sm text-muted-foreground">₹</span>
                <input
                  inputMode="numeric"
                  placeholder="1000 ya -500 (discount)"
                  value={r.amount || ""}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d-]/g, "");
                    update(r.id, { amount: Number(raw) || 0 });
                  }}
                  className="w-full bg-transparent text-[13px] text-right outline-none"
                />
              </div>
              <select
                value={r.appliesTo}
                onChange={(e) => update(r.id, { appliesTo: e.target.value as FeeRuleAppliesTo })}
                className="rounded-lg border border-border bg-surface px-2.5 py-2 text-[13px]"
              >
                {APPLIES_TO_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            {r.key === "RECASE" && (
              <p className="text-[10px] text-muted-foreground">
                Ye rule sirf tabhi lagega jab patient 1 saal se follow-up ke liye nahi aaya (automatic check, extra setting nahi chahiye).
              </p>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addRule}
          className="w-full rounded-full border-2 border-dashed border-accent text-accent-foreground font-semibold py-2 text-[13px]"
        >
          + Naya rule add karo
        </button>
        {draft && (
          <button
            onClick={save}
            disabled={saving || rules.some((r) => !r.label.trim())}
            className="w-full rounded-full bg-accent text-accent-foreground font-bold py-2.5 text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Fee Rules"}
          </button>
        )}
        <p className="text-[11px] text-muted-foreground">
          Amount negative bhi ho sakta hai (discount). "Applies to" dropdown decide karta hai kaunse visit type pe Payment screen mein ye khud-ba-khud jud jaayega.
        </p>
      </div>
    </div>
  );
}

// ---------- Next Visit Options (Rx improvements item F, 03 Aug 2026) ----------
// Was 3 hardcoded quick-buttons (30/60/90 days) baked into the Rx screen —
// same add/remove pattern as Extra Fee Rules above.
function NextVisitOptionsCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["next-visit-options"], queryFn: fetchNextVisitOptions });
  const saved = data ?? DEFAULT_NEXT_VISIT_OPTIONS;
  const [draft, setDraft] = useState<NextVisitOption[] | null>(null);
  const [saving, setSaving] = useState(false);
  const options = draft ?? saved;

  const update = (id: string, patch: Partial<NextVisitOption>) => {
    setDraft(options.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  };

  const addOption = () => {
    setDraft([...options, { id: crypto.randomUUID(), label: "", days: 30 }]);
  };

  const removeOption = (id: string) => {
    setDraft(options.filter((o) => o.id !== id));
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await saveNextVisitOptions(draft);
      qc.invalidateQueries({ queryKey: ["next-visit-options"] });
      setDraft(null);
      toast.success("Next visit options update ho gaye");
    } catch (e: any) {
      toast.error(e?.message ?? "Save nahi hua");
    }
    setSaving(false);
  };

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
        Next Visit Options — Rx screen ke quick-buttons
      </div>
      <div className="rounded-2xl bg-surface border border-border p-3.5 space-y-3">
        {options.length === 0 && (
          <p className="text-[12px] text-muted-foreground">Koi option nahi hai. Neeche se add karo.</p>
        )}
        {options.map((o) => (
          <div key={o.id} className="flex items-center gap-2">
            <input
              placeholder="Label (jaise: 1 Month)"
              value={o.label}
              onChange={(e) => update(o.id, { label: e.target.value })}
              className="flex-1 min-w-0 rounded-lg border border-border bg-background px-2.5 py-2 text-[13px]"
            />
            <input
              inputMode="numeric"
              placeholder="Din"
              value={o.days || ""}
              onChange={(e) => update(o.id, { days: Number(e.target.value.replace(/\D/g, "")) || 0 })}
              className="w-16 rounded-lg border border-border bg-background px-2 py-2 text-[13px] text-right"
            />
            <span className="text-[11px] text-muted-foreground shrink-0">din</span>
            <button
              type="button"
              onClick={() => removeOption(o.id)}
              className="shrink-0 h-8 w-8 grid place-items-center rounded-full bg-destructive/10 text-destructive"
              aria-label="Option hatao"
              title="Option hatao"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addOption}
          className="w-full rounded-full border-2 border-dashed border-accent text-accent-foreground font-semibold py-2 text-[13px]"
        >
          + Naya option add karo
        </button>
        {draft && (
          <button
            onClick={save}
            disabled={saving || options.some((o) => !o.label.trim() || o.days <= 0)}
            className="w-full rounded-full bg-accent text-accent-foreground font-bold py-2.5 text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Options"}
          </button>
        )}
        <p className="text-[11px] text-muted-foreground">
          Ye buttons Rx screen pe "Next visit" ke neeche dikhte hain — doctor tap karke seedha date set kar sakta hai.
        </p>
      </div>
    </div>
  );
}

// ---------- SLX Instructions (Rx improvements item E, 03 Aug 2026) ----------
function SlxInstructionsCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["slx-instructions"], queryFn: fetchSlxInstructions });
  const saved = data ?? DEFAULT_SLX_INSTRUCTIONS;
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = draft ?? saved;

  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    try {
      await saveSlxInstructions(draft);
      qc.invalidateQueries({ queryKey: ["slx-instructions"] });
      setDraft(null);
      toast.success("SLX instructions update ho gayi");
    } catch (e: any) {
      toast.error(e?.message ?? "Save nahi hua");
    }
    setSaving(false);
  };

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
        SLX Instructions — "lene ka tarika"
      </div>
      <div className="rounded-2xl bg-surface border border-border p-3.5 space-y-2.5">
        <textarea
          rows={3}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          placeholder="SLX kaise leni hai — Rx PDF aur consult screen dono par yahi text dikhega"
        />
        {draft !== null && draft !== saved && (
          <button
            onClick={save}
            disabled={saving || !draft.trim()}
            className="w-full rounded-full bg-accent text-accent-foreground font-bold py-2.5 text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Instructions"}
          </button>
        )}
        <p className="text-[11px] text-muted-foreground">
          Jab SLX toggle Rx screen pe ON ho, ye text doctor ko dikhega aur Rx PDF par bhi print hoga.
        </p>
      </div>
    </div>
  );
}

function OtherModules() {
  const links: { label: string; to: string; note: string }[] = [
    { label: "Lead CRM", to: "/leads", note: "Enquiries, HOT/Warm/Cold, convert to patient" },
    { label: "Follow-up CRM", to: "/follow-up", note: "Overdue + upcoming follow-up calls" },
    { label: "Deliveries (Courier)", to: "/delivery", note: "Advance-paid medicine delivery tracking" },
  ];
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
        Other Modules — already built
      </div>
      <div className="rounded-2xl bg-surface border border-border overflow-hidden divide-y divide-border">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="flex items-center justify-between px-3.5 py-3">
            <div>
              <div className="text-[13px] font-semibold text-primary">{l.label}</div>
              <div className="text-[11px] text-muted-foreground">{l.note}</div>
            </div>
            <span className="text-muted-foreground text-lg">›</span>
          </Link>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        WhatsApp (auto reminders), Hidden Identity (Case-DR contact-info hiding), Partial/Advance
        payment, and Case-DR Junior/Senior access are also live — built into their own screens,
        not separate toggles. Case-DR levels: Owner → Staff.
      </p>
    </div>
  );
}

function PlannedModules() {
  const items = ["Online Booking (patient self-service)", "Home Visits", "Marketing Module (GIOS — website/social/GMB)"];
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
        Planned — not built yet
      </div>
      <div className="rounded-2xl bg-muted/50 border border-dashed border-border p-3.5 space-y-2">
        {items.map((i) => (
          <div key={i} className="text-[13px] text-muted-foreground flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
            {i}
          </div>
        ))}
      </div>
    </div>
  );
}


function ControlPage() {
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const [showBackupModal, setShowBackupModal] = useState(false);

  const backupCfg: BackupDoctorConfig | null = (() => {
    const row = (data ?? []).find((r: any) => r.key === "backup_doctor_config");
    try {
      return row?.value ? JSON.parse(row.value) : null;
    } catch {
      return null;
    }
  })();
  const backupIsOn = !!backupCfg?.enabled;

  return (
    <RoleShell wide
      title="Owner Control Centre"
      subtitle="Master switches"
      nav={OWNER_NAV}
      right={
        <Link
          to="/owner/health"
          className="rounded-full bg-white/15 text-primary-foreground text-[11px] px-3 py-1.5 font-semibold inline-flex items-center gap-1"
        >
          <Activity className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-4">
          {showBackupModal && <BackupDoctorModal onClose={() => setShowBackupModal(false)} />}
          <ReceptionPermissionsGrid
            settings={data ?? []}
            items={RECEPTION_SCREENS}
            title="Reception Permissions — per screen ON/OFF"
            helpText="Default sabke liye ON hai. Jisko rokna ho us role ka wahi switch OFF kar do — turant apply hoga."
          />
          <ReceptionPermissionsGrid
            settings={data ?? []}
            items={RECEPTION_FEATURES}
            title="Feature-level Permissions — within a screen"
            helpText="Screen ON hone ke baad bhi in specific actions ko alag se rok sakte ho — poora screen band karne ki zaroorat nahi."
          />
          <JustDialToggle settings={data ?? []} />
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Backup Doctor
            </div>
            <button
              onClick={() => setShowBackupModal(true)}
              className="w-full rounded-2xl bg-surface border border-border p-3.5 flex items-center justify-between text-left"
            >
              <div>
                <div className="text-sm font-semibold text-primary">
                  {backupIsOn ? "Active — tap to change" : "Not active — tap to set up"}
                </div>
                {backupIsOn && backupCfg && (
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {new Date(backupCfg.start).toLocaleString("en-IN")} → {new Date(backupCfg.end).toLocaleString("en-IN")}
                  </div>
                )}
              </div>
              <span className={cn("h-3 w-3 rounded-full shrink-0", backupIsOn ? "bg-success" : "bg-border")} />
            </button>
          </div>
          <FeeMasterCard />
          <FeeRulesCard />
          <NextVisitOptionsCard />
          <SlxInstructionsCard />
          <OtherModules />
          <PlannedModules />
        </div>
      )}
    </RoleShell>
  );
}

