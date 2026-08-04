import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AuthGate, LoadingBlock } from "@/components/yhc/AuthGate";
import { DoctorShell } from "@/components/yhc/DoctorShell";
import { fetchReferenceRubrics, DEFAULT_REFERENCE_RUBRICS } from "@/lib/db";

export const Route = createFileRoute("/doctor/case/reference")({
  head: () => ({ meta: [{ title: "Reference — Doctor App" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["CASE_DR", "DOCTOR", "OWNER"]} permKey="caseReference">
      <ReferencePage />
    </AuthGate>
  ),
});

function ReferencePage() {
  // 04 Aug 2026 — was a hardcoded 5-entry array; now Owner-editable from
  // Control Centre (saveReferenceRubrics), same open-list-in-settings
  // pattern as Next Visit Options / Fee Rules. Falls back to the same 5
  // defaults if Owner hasn't touched it yet, so this screen never shows
  // empty for existing staff.
  const { data, isLoading } = useQuery({ queryKey: ["reference-rubrics"], queryFn: fetchReferenceRubrics });
  const rubrics = data ?? DEFAULT_REFERENCE_RUBRICS;

  return (
    <DoctorShell title="Reference" subtitle="Read only" nav="case">
      <div className="rounded-2xl bg-surface border border-border p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Common rubrics cheat sheet
        </div>
        {isLoading ? (
          <LoadingBlock />
        ) : rubrics.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">Koi rubric add nahi hua abhi — Owner Control Centre se add karo.</p>
        ) : (
          rubrics.map((r) => (
            <div key={r.id} className="py-2.5 border-b border-border last:border-b-0">
              <div className="text-[13.5px] font-bold text-primary">{r.rubric}</div>
              <div className="text-[12.5px] text-muted-foreground">{r.remedies}</div>
            </div>
          ))
        )}
      </div>

      <div className="mt-3 rounded-2xl bg-surface border border-border p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Generals quick reference
        </div>
        <div className="text-[13px] text-primary leading-relaxed space-y-1">
          <p><b>Thermals:</b> Chilly = feels cold · Hot = feels warm</p>
          <p><b>Thirst:</b> Quantity, temperature preference — note both</p>
          <p><b>Modalities:</b> Time, temperature, position, motion</p>
          <p><b>Mentals rank highest</b> in remedy selection</p>
        </div>
      </div>
    </DoctorShell>
  );
}
