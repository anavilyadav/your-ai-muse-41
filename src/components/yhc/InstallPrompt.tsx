import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const onPrompt = (e: any) => {
      e.preventDefault();
      setDeferred(e);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!deferred || dismissed) return null;

  const install = async () => {
    deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-24px)] max-w-[406px]">
      <div className="rounded-2xl bg-primary text-primary-foreground shadow-lg p-3.5 flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-accent text-accent-foreground grid place-items-center font-bold shrink-0">Y</div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold">Install YHC-OS</div>
          <div className="text-[11px] text-primary-foreground/70">Phone pe app jaisa install karo</div>
        </div>
        <button onClick={install} className="shrink-0 rounded-full bg-accent text-accent-foreground text-[12px] font-bold px-3 py-1.5 inline-flex items-center gap-1">
          <Download className="h-3.5 w-3.5" /> Install
        </button>
        <button onClick={() => setDismissed(true)} className="shrink-0 h-7 w-7 grid place-items-center rounded-full bg-white/10" aria-label="Dismiss">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
