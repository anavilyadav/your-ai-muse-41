import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PhoneCall, MessageCircle, X } from "lucide-react";
import { toast } from "sonner";
import { fetchInteractions, logCallInteraction } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Bottom-sheet modal: call/WhatsApp timeline for one lead or one patient,
 * plus a quick "log a call" box. Pass exactly one of leadId/patientId.
 * This is the shared piece behind both Lead CRM and Follow-up CRM so a
 * staff handover always carries "what was said 2 days ago" forward.
 */
export function InteractionHistoryModal({
  leadId,
  patientId,
  name,
  onClose,
}: {
  leadId?: string;
  patientId?: string;
  name: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const queryKey = ["interactions", leadId ?? patientId];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchInteractions({ leadId, patientId }),
  });
  const items = data ?? [];
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const logCall = async () => {
    if (!note.trim()) { toast.error("Kya baat hui, likho pehle"); return; }
    setSaving(true);
    const res = await logCallInteraction({ leadId, patientId, summary: note, createdBy: user?.name });
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    setNote("");
    qc.invalidateQueries({ queryKey });
    toast.success("Call log ho gayi");
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-extrabold text-primary text-lg">History</h2>
            <p className="text-[11px] text-muted-foreground">{name}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="rounded-xl bg-surface border border-border p-3">
          <label className="text-[11px] font-bold text-muted-foreground uppercase">Log a call</label>
          <textarea
            rows={2}
            placeholder="Kya baat hui... (e.g. next week aane ko bola, price pe doubt tha)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-lg bg-background border border-input px-3 py-2 text-sm resize-none"
          />
          <button
            onClick={logCall}
            disabled={saving}
            className="mt-2 w-full rounded-lg bg-primary text-primary-foreground py-2 text-xs font-bold disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Call Note"}
          </button>
        </div>

        <div className="mt-4">
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Timeline</div>
          {isLoading ? (
            <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">Koi call ya message record nahi hai abhi.</p>
          ) : (
            <ul className="space-y-2">
              {items.map((it) => (
                <li key={it.id} className="rounded-xl bg-surface border border-border p-2.5 flex gap-2.5">
                  <div
                    className={cn(
                      "h-7 w-7 shrink-0 rounded-full grid place-items-center",
                      it.type === "call" ? "bg-success/20 text-success" : "bg-accent/25 text-accent-foreground",
                    )}
                  >
                    {it.type === "call" ? <PhoneCall className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-foreground leading-snug">{it.summary}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {it.created_by ? `${it.created_by} • ` : ""}{timeAgo(it.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
