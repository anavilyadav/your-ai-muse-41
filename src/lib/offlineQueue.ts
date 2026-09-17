// Offline register support (#14, Dr. Yadav's spec 17 Sep 2026) — scoped to
// what was actually asked for: clinic wifi drops for a few minutes at a
// time, not hours. Today's queue already survives that for free (see
// router.tsx — React Query keeps stale data on screen and refetches on
// reconnect). What didn't survive it: a new-patient registration or a
// payment collection typed in right as the connection drops used to just
// fail and lose the staff member's work.
//
// This is a local retry buffer, not a full offline-first rewrite: if the
// network call fails for connectivity reasons, the exact submission is
// saved to localStorage (survives a reload) with a client-generated
// idempotency key, and retried automatically the moment the browser comes
// back online or on a short interval. The same idempotency key is reused
// on every retry, so if the first attempt actually reached the server but
// the response never came back, the retry is recognised server-side
// (register_patient_with_visit / collect_payment_atomic) and returns the
// original result instead of creating a duplicate.
//
// Deliberately NOT in scope: rendering a local, un-synced patient profile,
// temp IDs, or any merge-on-sync UI — the staff member stays on the
// register/payment screen with a "queued, will sync" message instead of
// navigating to a patient record that doesn't exist on the server yet.

export type QueuedActionType = "register" | "payment";

export interface QueuedAction {
  id: string;
  type: QueuedActionType;
  payload: Record<string, unknown>;
  label: string; // short human description for the pending-sync UI
  createdAt: string;
  attempts: number;
  lastError?: string;
}

const STORAGE_KEY = "yhc_offline_queue_v1";
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribeToQueue(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readQueue(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedAction[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedAction[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage full/unavailable — the in-flight submission still surfaces
    // its normal error to the caller; nothing worse happens.
  }
  notify();
}

export function getQueue(): QueuedAction[] {
  return readQueue();
}

export function enqueueAction(type: QueuedActionType, payload: Record<string, unknown>, label: string): string {
  const id = crypto.randomUUID();
  const items = readQueue();
  items.push({ id, type, payload, label, createdAt: new Date().toISOString(), attempts: 0 });
  writeQueue(items);
  return id;
}

function removeAction(id: string) {
  writeQueue(readQueue().filter((i) => i.id !== id));
}

function recordFailure(id: string, message: string) {
  writeQueue(readQueue().map((i) => (i.id === id ? { ...i, attempts: i.attempts + 1, lastError: message } : i)));
}

// Heuristic, not exact — the goal is "don't queue a real validation error
// (bad mobile number, missing name) as if it were a connectivity problem",
// not perfect network-condition detection. A validation error comes back
// from a reached server with a specific message; a connectivity failure
// never reaches the server at all.
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|network ?error|load failed|networkrequestfailed|err_internet_disconnected|err_network/i.test(msg);
}

type Submitter = (payload: any) => Promise<void>;
const submitters: Partial<Record<QueuedActionType, Submitter>> = {};

// Registered lazily by the screens that know how to replay their own
// queued actions (register.tsx / pay.$id.tsx) — keeps this module free of
// a direct dependency on db.ts's full surface.
export function registerSubmitter(type: QueuedActionType, fn: Submitter) {
  submitters[type] = fn;
}

let flushing = false;

export async function flushQueue(): Promise<void> {
  if (flushing) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  flushing = true;
  try {
    const items = readQueue();
    for (const item of items) {
      const submit = submitters[item.type];
      if (!submit) continue;
      try {
        await submit(item.payload);
        removeAction(item.id);
      } catch (e) {
        if (isNetworkError(e)) {
          // Still offline — stop trying the rest this round rather than
          // burning through every queued item's error path back-to-back.
          break;
        }
        // A real server-side rejection (not connectivity) — keep it queued
        // with the error visible so staff know it needs attention, but
        // don't retry it in a tight loop.
        recordFailure(item.id, e instanceof Error ? e.message : String(e));
      }
    }
  } finally {
    flushing = false;
  }
}

let autoSyncStarted = false;

export function startOfflineQueueAutoSync() {
  if (autoSyncStarted || typeof window === "undefined") return;
  autoSyncStarted = true;
  window.addEventListener("online", () => void flushQueue());
  setInterval(() => void flushQueue(), 20_000);
  void flushQueue();
}
