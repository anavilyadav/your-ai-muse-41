import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Check, RectangleHorizontal, RectangleVertical, X, Zap, ZapOff } from "lucide-react";
import { cn } from "@/lib/utils";

// In-app paper camera (21 Nov 2026, Dr. Yadav): photos were clicked first
// and "scanned" afterwards, so staff only saw the result once it was
// already wrong, and every page came out a different size. Here the camera
// shows an A4 border and the scan look live — what is on screen is what is
// saved — and every page is cut to the same A4 size. With "Auto" on, the
// photo is taken by itself once a paper fills the border and the phone is
// held still; the round button always takes it by hand.

const A4 = 297 / 210; // height : width of an A4 sheet
const OUT_W = 1654; // A4 at 200 dpi — readable handwriting, same size every page
const OUT_H = 2339;
const SCAN_FILTER = "contrast(1.25) brightness(1.08) saturate(0.9)";

type Look = "scan" | "asli";

export function ScanCamera({ onClose, onDone }: { onClose: () => void; onDone: (files: File[]) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [look, setLook] = useState<Look>("scan");
  const [landscape, setLandscape] = useState(false);
  const [auto, setAuto] = useState(true);
  const [torch, setTorch] = useState<boolean | null>(null); // null = phone has no torch control
  const [shots, setShots] = useState<{ file: File; url: string }[]>([]);
  const [flash, setFlash] = useState(false);
  const [hint, setHint] = useState("Paper ko border ke andar lao");
  const [box, setBox] = useState({ w: 0, h: 0 });
  // latest callbacks for the long-lived camera / auto-click loops, so a
  // re-render never restarts the camera or forgets the auto-click state
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // start the back camera at the best resolution the phone gives
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error("Is phone/browser me camera nahi khul sakta — gallery se photo chuno");
        onCloseRef.current();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) { v.srcObject = stream; await v.play().catch(() => {}); }
        const track = stream.getVideoTracks()[0];
        const caps: any = track?.getCapabilities?.() ?? {};
        if (caps.torch) setTorch(false);
        setReady(true);
      } catch {
        toast.error("Camera ki permission nahi mili — phone settings me camera allow karo, ya gallery se photo chuno");
        onCloseRef.current();
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the A4 border inside the camera area
  const frame = (() => {
    const ratio = landscape ? 1 / A4 : A4; // h / w
    let w = box.w * 0.9;
    let h = w * ratio;
    if (h > box.h * 0.9) { h = box.h * 0.9; w = h / ratio; }
    return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
  })();

  // where the border sits in the camera's own pixels (the video fills the
  // area like object-fit: cover)
  const frameInVideo = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !box.w) return null;
    const scale = Math.max(box.w / v.videoWidth, box.h / v.videoHeight);
    const ox = (box.w - v.videoWidth * scale) / 2;
    const oy = (box.h - v.videoHeight * scale) / 2;
    return { sx: (frame.x - ox) / scale, sy: (frame.y - oy) / scale, sw: frame.w / scale, sh: frame.h / scale };
  }, [box, frame.x, frame.y, frame.w, frame.h]);

  const take = useCallback(async () => {
    const v = videoRef.current;
    const r = frameInVideo();
    if (!v || !r) return;
    const canvas = document.createElement("canvas");
    canvas.width = landscape ? OUT_H : OUT_W;
    canvas.height = landscape ? OUT_W : OUT_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (look === "scan" && "filter" in ctx) (ctx as any).filter = SCAN_FILTER;
    ctx.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
    if (!blob) return;
    const file = new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" });
    setShots((s) => [...s, { file, url: URL.createObjectURL(file) }]);
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
  }, [frameInVideo, landscape, look]);
  const frameRef = useRef(frameInVideo);
  frameRef.current = frameInVideo;
  const takeRef = useRef(take);
  takeRef.current = take;

  // Auto: watch a small copy of the picture — when the middle of the border
  // is clearly brighter than the band just outside it (a paper on a table)
  // and the picture has stopped moving for about a second, take the photo;
  // then wait for the next page to be brought in before taking another.
  useEffect(() => {
    if (!ready || !auto) { setHint("Paper border me rakho aur gol button dabao"); return; }
    const v = videoRef.current;
    const small = document.createElement("canvas");
    const SW = 48, SH = 68;
    small.width = SW; small.height = SH;
    const sctx = small.getContext("2d", { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
    let prev: Uint8ClampedArray | null = null;
    let still = 0;
    let armed = true;
    const id = setInterval(() => {
      const r = frameRef.current();
      if (!v || !r || !sctx) return;
      // a bit more than the border, so the outside band can be compared
      const padX = r.sw * 0.12, padY = r.sh * 0.12;
      sctx.drawImage(v, r.sx - padX, r.sy - padY, r.sw + 2 * padX, r.sh + 2 * padY, 0, 0, SW, SH);
      const d = sctx.getImageData(0, 0, SW, SH).data;
      const lum = (i: number) => (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
      let inSum = 0, inN = 0, outSum = 0, outN = 0, diff = 0;
      const bx = Math.round(SW * 0.12 / 1.24), by = Math.round(SH * 0.12 / 1.24);
      for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
        const i = (y * SW + x) * 4;
        const l = lum(i);
        const inside = x >= bx + 2 && x < SW - bx - 2 && y >= by + 2 && y < SH - by - 2;
        const outside = x < bx - 1 || x >= SW - bx + 1 || y < by - 1 || y >= SH - by + 1;
        if (inside) { inSum += l; inN++; } else if (outside) { outSum += l; outN++; }
        if (prev) diff += Math.abs(l - prev[y * SW + x]);
      }
      const cur = new Uint8ClampedArray(SW * SH);
      for (let k = 0; k < SW * SH; k++) cur[k] = lum(k * 4);
      const motion = prev ? diff / (SW * SH) : 99;
      prev = cur;
      const inner = inSum / Math.max(1, inN), outer = outSum / Math.max(1, outN);
      const paperIn = inner > 90 && inner - outer > 18;
      if (!armed) {
        // after a photo, wait until the paper is changed (picture moves) before the next one
        if (motion > 10) armed = true;
        setHint("Agla paper rakho");
        still = 0;
        return;
      }
      if (!paperIn) { still = 0; setHint("Paper ko border ke andar lao"); return; }
      if (motion < 3.5) still++; else still = 0;
      if (still >= 4) {
        setHint("Click!");
        armed = false;
        still = 0;
        void takeRef.current();
      } else {
        setHint("Haath sthir rakho…");
      }
    }, 250);
    return () => clearInterval(id);
  }, [ready, auto]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch } as any] }); setTorch(!torch); } catch { /* phone refused */ }
  };

  const finish = () => {
    if (shots.length === 0) { onClose(); return; }
    onDone(shots.map((s) => s.file));
  };

  const btn = "rounded-full px-3 py-1.5 text-[11.5px] font-bold inline-flex items-center gap-1.5";
  // drawn on top of the whole app (header and bottom menu included), not
  // inside the page that opened it
  return createPortal(
    <div
      className="fixed inset-0 bg-black flex flex-col text-white"
      style={{ zIndex: 200, paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="text-sm font-bold">Camera se scan {shots.length > 0 && <span className="opacity-70">• {shots.length} photo</span>}</div>
        <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-white/15"><X className="h-4 w-4" /></button>
      </div>

      <div ref={boxRef} className="relative flex-1 min-h-0 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover"
          style={{ filter: look === "scan" ? SCAN_FILTER : "none" }}
        />
        {box.w > 0 && (
          <>
            <div
              className="absolute pointer-events-none rounded-md"
              style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h, border: "3px solid #f2b84b", boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }}
            />
            <div className="absolute left-0 right-0 text-center pointer-events-none" style={{ top: Math.max(6, frame.y - 30) }}>
              <span className="rounded-full bg-black/60 px-3 py-1 text-[12px] font-bold">{hint}</span>
            </div>
          </>
        )}
        {flash && <div className="absolute inset-0 bg-white/70 pointer-events-none" />}
        {!ready && <div className="absolute inset-0 grid place-items-center text-sm opacity-80">Camera khul raha hai…</div>}
      </div>

      <div className="px-3 pt-2 flex flex-wrap items-center justify-center gap-1.5">
        <button onClick={() => setLook(look === "scan" ? "asli" : "scan")} className={cn(btn, "bg-white/15")}>
          {look === "scan" ? "Scan look ✓" : "Asli rang ✓"}
        </button>
        <button onClick={() => setLandscape(!landscape)} className={cn(btn, "bg-white/15")}>
          {landscape ? <RectangleHorizontal className="h-3.5 w-3.5" /> : <RectangleVertical className="h-3.5 w-3.5" />}
          {landscape ? "A4 aada" : "A4 seedha"}
        </button>
        <button onClick={() => setAuto(!auto)} className={cn(btn, auto ? "bg-accent text-accent-foreground" : "bg-white/15")}>
          Auto click {auto ? "ON" : "OFF"}
        </button>
        {torch !== null && (
          <button onClick={toggleTorch} className={cn(btn, "bg-white/15")}>
            {torch ? <Zap className="h-3.5 w-3.5" /> : <ZapOff className="h-3.5 w-3.5" />} Light
          </button>
        )}
      </div>

      <div className="px-3 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto">
          {shots.map((s, i) => (
            <div key={s.url} className="relative shrink-0">
              <img src={s.url} alt={`Scan ${i + 1}`} className="h-12 w-9 rounded object-cover border border-white/30" />
              <button
                onClick={() => setShots((all) => all.filter((_, k) => k !== i))}
                aria-label={`Scan ${i + 1} hatao`}
                className="absolute -top-1 -right-1 h-4 w-4 grid place-items-center rounded-full bg-destructive"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => void take()}
          disabled={!ready}
          aria-label="Photo lo"
          className="shrink-0 h-16 w-16 rounded-full active:scale-95 disabled:opacity-40"
          style={{ border: "4px solid #fff", background: "rgba(255,255,255,0.25)" }}
        />
        <div className="flex-1 flex justify-end">
          <button onClick={finish} className="rounded-full bg-success text-success-foreground px-4 py-2.5 text-sm font-bold inline-flex items-center gap-1.5">
            <Check className="h-4 w-4" /> Ho gaya{shots.length > 0 ? ` (${shots.length})` : ""}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
