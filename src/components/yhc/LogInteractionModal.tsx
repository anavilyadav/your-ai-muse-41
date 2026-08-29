import { useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { logPatientInteraction, INTERACTION_TYPES, INTERACTION_TYPE_LABELS, type InteractionType } from "@/lib/db";

// 04 Aug 2026 — Operational Manual Feature 2. Shared between the patient
// profile (Reception/RECP2 logging a call, WhatsApp reply, or query) and
// the Doctor Rx consult screen (logging verbal advice or a dose change
// given mid-consultation) — same table, same shape, no reason to fork it.
export function LogInteractionModal({
  patientId,
  onClose,
  onLogged,
}: {
  patientId: string;
  onClose: () => void;
  onLogged: () => void;
}) {
  const { user } = useAuth();
  const [type, setType] = useState<InteractionType>("CALL");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!note.trim()) {
      toast.error("Note likho — kya baat hui");
      return;
    }
    setSaving(true);
    const res = await logPatientInteraction(patientId, type, note, user?.name);
    setSaving(false);
    if (!res.success) {
      toast.error("Log nahi hua: " + res.error);
      return;
    }
    toast.success("Interaction log ho gaya");
    onLogged();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Log Interaction</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Type</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {INTERACTION_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={
                    "rounded-full px-3 py-1.5 text-[12px] font-bold border " +
                    (type === t ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground")
                  }
                >
                  {INTERACTION_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Dawa ka time poochha, sham 6 baje lene ko bola"
              rows={4}
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm resize-none"
            />
          </div>

          <button
            onClick={submit}
            disabled={saving || !note.trim()}
            className="mt-1 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Log Interaction"}
          </button>
        </div>
      </div>
    </div>
  );
}
