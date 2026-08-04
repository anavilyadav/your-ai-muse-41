import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { fetchPatientPhotoTimeline, type PhotoTimelineItem } from "@/lib/db";
import { SecureImage, SecurePhotoLightbox } from "./SecurePhoto";

function fmt(d: string) {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  return isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Every clinical photo for one patient — case papers, tongue, lab reports and
 * staff-uploaded documents — on a single date-descending timeline, so the
 * prescribing doctor can see how a skin complaint / ulcer / tumour changed
 * visit to visit without hunting through screens. Opens in-app only.
 */
export function PhotoTimeline({ patientId }: { patientId: string }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["photo-timeline", patientId],
    queryFn: () => fetchPatientPhotoTimeline(patientId),
    enabled: !!patientId,
    staleTime: 60_000,
  });

  const items: PhotoTimelineItem[] = data ?? [];

  const groups = items.reduce<Record<string, PhotoTimelineItem[]>>((acc, it) => {
    (acc[it.date] ||= []).push(it);
    return acc;
  }, {});
  const dates = Object.keys(groups);

  return (
    <div className="rounded-xl bg-surface border border-border p-3">
      <div className="text-[11px] font-bold uppercase text-muted-foreground mb-2 flex items-center gap-1">
        <Camera className="h-3 w-3" /> Photo timeline
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading photos…</div>
      ) : isError ? (
        <div className="text-xs text-destructive">Photos load nahi hui — dobara try karein.</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground">Is patient ki koi photo abhi tak nahi.</div>
      ) : (
        <ol className="space-y-3">
          {dates.map((date) => (
            <li key={date} className="border-l-2 border-accent/50 pl-3 relative">
              <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-accent" />
              <div className="text-[11px] font-bold text-primary">{fmt(date)}</div>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {groups[date].map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setOpenIdx(items.indexOf(it))}
                    className="block text-left"
                    aria-label={`Open ${it.label} from ${fmt(date)}`}
                  >
                    <SecureImage
                      src={it.url}
                      alt={it.label}
                      className="w-full aspect-square object-cover rounded-lg border border-border"
                    />
                    <div className="text-[10px] text-center text-muted-foreground mt-0.5 truncate">{it.label}</div>
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}

      {openIdx !== null && items[openIdx] && (
        <SecurePhotoLightbox
          items={items.map((i) => ({ id: i.id, url: i.url, label: i.label, date: fmt(i.date), note: i.note }))}
          index={openIdx}
          onIndexChange={setOpenIdx}
          onClose={() => setOpenIdx(null)}
        />
      )}
    </div>
  );
}
