import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getQueue, subscribeToQueue, flushQueue, startOfflineQueueAutoSync, type QueuedAction } from "@/lib/offlineQueue";

// #14 offline register — shows only when there's something waiting to
// sync (a registration or payment saved locally because the network was
// down when it was submitted). Silent the rest of the time; this is a
// recovery indicator, not a permanent fixture.
export function PendingSyncBanner() {
  const [items, setItems] = useState<QueuedAction[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    startOfflineQueueAutoSync();
    setItems(getQueue());
    return subscribeToQueue(() => setItems(getQueue()));
  }, []);

  if (items.length === 0) return null;

  const retryNow = async () => {
    setSyncing(true);
    await flushQueue();
    setSyncing(false);
  };

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-24px)] max-w-[420px]">
      <button
        onClick={retryNow}
        disabled={syncing}
        className="w-full flex items-center justify-center gap-2 rounded-full bg-accent text-accent-foreground text-[12px] font-bold px-4 py-2.5 shadow-lg disabled:opacity-70"
      >
        <RefreshCw className={syncing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
        {items.length} {items.length === 1 ? "item" : "items"} sync hona baaki hai — connection aate hi automatic ho jaayega
      </button>
    </div>
  );
}
