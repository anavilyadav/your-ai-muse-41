import { useEffect, useState } from "react";
import { X, ChevronLeft, ChevronRight, Loader2, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Clinical photos (skin lesions, ulcers, tongue, case papers, lab reports)
 * are patient-identifiable medical data. They must be viewable INSIDE the
 * app only — never openable in a browser tab, never saveable via long-press
 * or right-click, and the underlying signed URL must never be exposed as a
 * navigable link.
 *
 * So: fetch the signed URL once, keep the bytes as an in-memory blob object
 * URL, and render that. No <a href>, no target="_blank", context menu and
 * drag disabled. It is not DRM — a determined dev tools user can still get
 * the bytes — but it removes every ordinary "save image"/"open image" route
 * that staff and onlookers would otherwise have.
 */
function useBlobUrl(src: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    if (!src) return;
    (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  return { url, failed };
}

const blockers = {
  onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  onDragStart: (e: React.DragEvent) => e.preventDefault(),
  draggable: false,
} as const;

export function SecureImage({
  src,
  alt,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const { url, failed } = useBlobUrl(src);

  if (failed) {
    return (
      <div className={cn("grid place-items-center bg-muted text-[9px] text-muted-foreground", className)}>
        Load nahi hua
      </div>
    );
  }
  if (!url) {
    return (
      <div className={cn("grid place-items-center bg-muted", className)}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <img src={url} alt={alt} className={cn("select-none", className)} {...blockers} />;
}

export interface SecurePhotoItem {
  id: string;
  url: string;
  label: string;
  date?: string | null;
  note?: string | null;
}

export function SecurePhotoLightbox({
  items,
  index,
  onClose,
  onIndexChange,
}: {
  items: SecurePhotoItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}) {
  const item = items[index];
  // turn a sideways paper while reading it (21 Nov 2026) — only the view,
  // the stored photo is not changed; resets for the next photo
  const [turn, setTurn] = useState(0);
  useEffect(() => { setTurn(0); }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < items.length - 1) onIndexChange(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndexChange]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex flex-col"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0">
          <div className="text-sm font-bold truncate">{item.label}</div>
          {item.date && <div className="text-[11px] opacity-70">{item.date}</div>}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button
            onClick={() => setTurn((t) => (t + 90) % 360)}
            aria-label="Photo ghumao"
            className="h-9 px-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 text-[12px] font-bold"
          >
            <RotateCw className="h-4 w-4" /> Ghumao
          </button>
          <button
            onClick={onClose}
            aria-label="Close photo"
            className="h-9 w-9 grid place-items-center rounded-full bg-white/15 hover:bg-white/25"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center px-2 overflow-hidden">
        <div
          className="max-h-full max-w-full flex items-center justify-center transition-transform duration-200"
          // a quarter turn swaps width and height, so the turned photo is
          // shrunk to stay inside the screen
          style={{ transform: `rotate(${turn}deg)${turn % 180 ? " scale(0.7)" : ""}` }}
        >
          <SecureImage src={item.url} alt={item.label} className="max-h-[80vh] max-w-full object-contain rounded-lg" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-4 text-white">
        <button
          onClick={() => onIndexChange(index - 1)}
          disabled={index === 0}
          aria-label="Previous photo"
          className="h-10 w-10 grid place-items-center rounded-full bg-white/15 disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          {item.note && <p className="text-[11px] opacity-80 truncate">{item.note}</p>}
          <p className="text-[10px] opacity-50">
            {index + 1} / {items.length} • Photo app ke bahar save nahi hoti
          </p>
        </div>
        <button
          onClick={() => onIndexChange(index + 1)}
          disabled={index >= items.length - 1}
          aria-label="Next photo"
          className="h-10 w-10 grid place-items-center rounded-full bg-white/15 disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
