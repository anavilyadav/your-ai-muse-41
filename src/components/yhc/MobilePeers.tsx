import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { linkFamilyMember, RELATIONSHIPS, type MobilePeer } from "@/lib/db";

// Who else is on this patient's mobile, shown wherever a shared-mobile or
// same-name flag shows (Master List row, profile banner) — 30 Oct 2026, Dr.
// Yadav: "kiske saath link hai batao, family ho to add ho paye". Linking
// as family clears the flag everywhere on the next read (fetchSharingInfo).
export function MobilePeerHints({
  patient,
  peers,
  className,
  onLinked,
}: {
  patient: { id: string; name?: string | null };
  peers: MobilePeer[];
  className?: string;
  onLinked?: () => void;
}) {
  const [linking, setLinking] = useState<MobilePeer | null>(null);
  if (peers.length === 0) return null;
  const family = peers.filter((p) => p.relationship);
  const open = peers.filter((p) => !p.relationship);
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {open.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-destructive">
            Same mobile: <b>{p.name || "—"}</b> {p.card ? `[${p.card}]` : "[card nahi]"}
            {p.sameName && " — same naam, ek hi insaan to nahi?"}
          </span>
          <button
            type="button"
            onClick={() => setLinking(p)}
            className="rounded-full bg-primary text-primary-foreground px-2 py-0.5 text-[10px] font-bold"
          >
            + Family
          </button>
          <Link to="/patient/$id" params={{ id: p.id }} className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-semibold text-primary">
            Profile
          </Link>
        </div>
      ))}
      {family.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          Same mobile, family: {family.map((p) => `${p.name} (${p.relationship})`).join(", ")}
        </div>
      )}
      {linking && <FamilyQuickLinkModal patient={patient} peer={linking} onClose={() => setLinking(null)} onLinked={onLinked} />}
    </div>
  );
}

function FamilyQuickLinkModal({
  patient,
  peer,
  onClose,
  onLinked,
}: {
  patient: { id: string; name?: string | null };
  peer: MobilePeer;
  onClose: () => void;
  onLinked?: () => void;
}) {
  const qc = useQueryClient();
  const [relationship, setRelationship] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState(false);
  const finalRel = relationship === "Other" ? custom.trim() || "Other" : relationship;

  const save = async () => {
    if (!finalRel) { toast.error("Relation chuno"); return; }
    setSaving(true);
    const res = await linkFamilyMember(patient.id, peer.id, finalRel);
    setSaving(false);
    if (!res.success) { toast.error("Link nahi hua: " + res.error); return; }
    toast.success(`${peer.name} family me jud gaye`);
    // Every screen that shows these flags re-reads them.
    qc.invalidateQueries({ queryKey: ["list-sharing-flags"] });
    qc.invalidateQueries({ queryKey: ["dq-flags"] });
    onLinked?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center" onClick={(e) => e.stopPropagation()}>
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-extrabold text-primary text-lg">Family jodo</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-[12px] text-muted-foreground mb-2">
          <b>{peer.name}</b> {peer.card ? `[${peer.card}]` : ""}, <b>{patient.name}</b> ka <u>kya lagta hai</u>?
        </p>
        <div className="flex flex-wrap gap-1.5">
          {RELATIONSHIPS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRelationship(r)}
              className={cn(
                "rounded-full px-3 py-1.5 text-[12px] font-bold border",
                relationship === r ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground",
              )}
            >
              {r}
            </button>
          ))}
        </div>
        {relationship === "Other" && (
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Relation likho (jaise Bahnoi)"
            className="w-full mt-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
          />
        )}
        {finalRel && (
          <p className="text-[11px] mt-2 rounded-lg bg-primary/10 border border-primary/30 px-2 py-1.5 text-primary font-semibold">
            ✓ {peer.name}, {patient.name} ka <b>{finalRel}</b> hai.
          </p>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">
          Ek hi insaan ke do record hain to family mat jodo — profile me "Merge" karo.
        </p>
        <button onClick={save} disabled={saving} className="mt-3 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
          {saving ? "Jod rahe hain…" : "Family me jodo"}
        </button>
      </div>
    </div>
  );
}
