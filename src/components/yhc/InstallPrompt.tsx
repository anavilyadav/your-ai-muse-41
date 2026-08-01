import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { toast } from "sonner";

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      // `controller` is only truthy if a service worker was ALREADY
      // controlling this tab before we registered. On a first-ever visit
      // (or a fresh/incognito tab, or right after a cache-clear) there is
      // no prior controller — register() installs one for the first time,
      // which also fires `controllerchange`, but that is not an "update",
      // it's just the very first activation. Capturing this flag before
      // register() runs is what lets us tell the two apart below.
      const hadControllerBeforeRegister = !!navigator.serviceWorker.controller;

      navigator.serviceWorker.register("/sw.js").catch(() => {});

      // sw.js calls self.skipWaiting() + self.clients.claim() immediately
      // on every deploy — the new worker takes over an already-open tab
      // mid-session with zero signal to the user. That's fine for the
      // service worker's own static-asset cache (it's versioned/cleaned
      // up correctly), but the already-loaded JS bundle in memory can
      // drift from what's now being served, and nothing told staff to
      // refresh. This shows a manual, dismissible reload prompt instead
      // of auto-reloading — auto-reload mid-registration or mid-case-
      // taking would lose unsaved work, which matters more here than
      // getting everyone onto the new version instantly.
      let refreshed = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshed) return; // controllerchange can fire more than once
        refreshed = true;
        if (!hadControllerBeforeRegister) return; // first-ever activation, not a real update — stay silent
        toast("Naya version available hai", {
          description: "Reload karo latest fixes ke liye",
          duration: Infinity,
          action: {
            label: "Reload",
            onClick: () => window.location.reload(),
          },
          // Without this the toast had no way to go away on its own — on
          // top-center it would sit over the header/logo until the person
          // reloaded, which then re-claimed and could show it again (loop).
          // A real dismiss lets someone finish what they're doing first.
          cancel: {
            label: "Baad mein",
            onClick: () => {},
          },
        });
      });
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
