import { useEffect, useRef, useState } from "react";
import { Check, X, RotateCcw } from "lucide-react";

// A real "scan" step for case-file/photo uploads — crop out the table/
// background around a paper document and apply the same contrast/
// brightness boost a scanner app would, before the file ever gets
// compressed and uploaded. This is a straight-edges crop (drag the 4
// corners of a rectangle), not full perspective/skew correction — canvas
// 2D can't warp a quad into a rectangle without a lot more machinery, and
// a clean rectangular crop already removes most of what makes a phone
// photo look like a phone photo instead of a scan.
//
// Deliberately skippable ("Poori Photo Rakho") — not every upload is a
// paper document that needs cropping (e.g. a tongue photo), and forcing
// this step on everything would just slow staff down.

type Rect = { x: number; y: number; w: number; h: number };
const HANDLE = 22;

export function ScanCropModal({
  file,
  onCancel,
  onConfirm,
}: {
  file: File;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [display, setDisplay] = useState({ w: 0, h: 0 });
  const [rect, setRect] = useState<Rect | null>(null);
  const dragRef = useRef<{ corner: "tl" | "tr" | "bl" | "br" | "move"; startX: number; startY: number; startRect: Rect } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onImgLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    const w = img.clientWidth, h = img.clientHeight;
    setDisplay({ w, h });
    const inset = 0.04; // paper is usually already fairly tight in the frame
    setRect({ x: w * inset, y: h * inset, w: w * (1 - 2 * inset), h: h * (1 - 2 * inset) });
  };

  const resetRect = () => {
    if (!display.w) return;
    const inset = 0.04;
    setRect({ x: display.w * inset, y: display.h * inset, w: display.w * (1 - 2 * inset), h: display.h * (1 - 2 * inset) });
  };

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const onPointerDown = (corner: "tl" | "tr" | "bl" | "br" | "move") => (e: React.PointerEvent) => {
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { corner, startX: e.clientX, startY: e.clientY, startRect: rect };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !rect) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const MIN = 40;
    let { x, y, w, h } = d.startRect;
    if (d.corner === "move") {
      x = clamp(d.startRect.x + dx, 0, display.w - d.startRect.w);
      y = clamp(d.startRect.y + dy, 0, display.h - d.startRect.h);
    } else {
      let x2 = d.startRect.x + d.startRect.w;
      let y2 = d.startRect.y + d.startRect.h;
      if (d.corner === "tl") { x = clamp(d.startRect.x + dx, 0, x2 - MIN); y = clamp(d.startRect.y + dy, 0, y2 - MIN); }
      if (d.corner === "tr") { x2 = clamp(x2 + dx, x + MIN, display.w); y = clamp(d.startRect.y + dy, 0, y2 - MIN); }
      if (d.corner === "bl") { x = clamp(d.startRect.x + dx, 0, x2 - MIN); y2 = clamp(y2 + dy, y + MIN, display.h); }
      if (d.corner === "br") { x2 = clamp(x2 + dx, x + MIN, display.w); y2 = clamp(y2 + dy, y + MIN, display.h); }
      w = x2 - x; h = y2 - y;
    }
    setRect({ x, y, w, h });
  };

  const onPointerUp = () => { dragRef.current = null; };

  const confirmCrop = async () => {
    if (!rect || !natural.w || !display.w) { onConfirm(file); return; }
    const scale = natural.w / display.w;
    const sx = rect.x * scale, sy = rect.y * scale, sw = rect.w * scale, sh = rect.h * scale;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext("2d");
    if (!ctx || !imgRef.current) { onConfirm(file); return; }
    if ("filter" in ctx) (ctx as any).filter = "contrast(1.35) brightness(1.12) saturate(0.85)";
    ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) { onConfirm(file); return; }
    const newName = file.name.replace(/\.[^.]+$/, "") + "-scan.jpg";
    onConfirm(new File([blob], newName, { type: "image/jpeg" }));
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <h2 className="font-bold text-sm">Kinaare adjust karo</h2>
        <button onClick={onCancel} aria-label="Cancel" className="h-8 w-8 grid place-items-center rounded-full bg-white/15">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div ref={containerRef} className="flex-1 flex items-center justify-center overflow-hidden touch-none select-none">
        <div className="relative" style={{ width: display.w || "auto", height: display.h || "auto" }}>
          {src && (
            <img
              ref={imgRef}
              src={src}
              onLoad={onImgLoad}
              alt="Scan"
              className="block max-w-[92vw] max-h-[70vh]"
              draggable={false}
            />
          )}
          {rect && display.w > 0 && (
            <>
              {/* Dim everything outside the selected rectangle */}
              <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: `0 0 0 9999px rgba(0,0,0,0.6)`, left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
              <div
                onPointerDown={onPointerDown("move")}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className="absolute border-2 border-accent"
                style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, cursor: "move" }}
              />
              {([
                ["tl", rect.x, rect.y],
                ["tr", rect.x + rect.w, rect.y],
                ["bl", rect.x, rect.y + rect.h],
                ["br", rect.x + rect.w, rect.y + rect.h],
              ] as const).map(([corner, cx, cy]) => (
                <div
                  key={corner}
                  onPointerDown={onPointerDown(corner)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  className="absolute rounded-full bg-accent border-2 border-white"
                  style={{ left: cx - HANDLE / 2, top: cy - HANDLE / 2, width: HANDLE, height: HANDLE, touchAction: "none" }}
                />
              ))}
            </>
          )}
        </div>
      </div>
      <div className="p-4 flex flex-col gap-2">
        <div className="flex gap-2">
          <button onClick={resetRect} className="flex-1 rounded-full bg-white/15 text-white text-[12px] font-bold py-2.5 inline-flex items-center justify-center gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
          <button onClick={() => onConfirm(file)} className="flex-1 rounded-full bg-white/15 text-white text-[12px] font-bold py-2.5">
            Poori Photo Rakho
          </button>
        </div>
        <button onClick={confirmCrop} className="w-full rounded-full bg-success text-success-foreground font-bold py-3 text-sm inline-flex items-center justify-center gap-2">
          <Check className="h-4 w-4" /> Scan Karo
        </button>
      </div>
    </div>
  );
}
