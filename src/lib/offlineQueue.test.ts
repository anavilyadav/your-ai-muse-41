// #14 offline register — the local retry buffer that saves a
// registration/payment when the network drops mid-submit and replays it
// once connectivity (or the retry interval) comes back. The critical
// property under test: a submission that fails with a real server
// rejection is never silently dropped, and a successful replay always
// clears the item so it's not retried forever.

import { describe, it, expect, beforeEach, vi } from "vitest";

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe("offlineQueue", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", makeMemoryStorage());
  });

  it("enqueue then getQueue round-trips the payload", async () => {
    const { enqueueAction, getQueue } = await import("./offlineQueue");
    const id = enqueueAction("register", { name: "Test Patient" }, "Registration — Test Patient");
    const items = getQueue();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(id);
    expect(items[0].payload).toEqual({ name: "Test Patient" });
    expect(items[0].attempts).toBe(0);
  });

  it("isNetworkError recognises fetch-failure messages but not validation errors", async () => {
    const { isNetworkError } = await import("./offlineQueue");
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("NetworkError when attempting to fetch resource"))).toBe(true);
    expect(isNetworkError(new Error("Mobile number required"))).toBe(false);
    expect(isNetworkError(new Error("adjustment not found"))).toBe(false);
  });

  it("flushQueue removes an item once its submitter succeeds", async () => {
    const { enqueueAction, getQueue, flushQueue, registerSubmitter } = await import("./offlineQueue");
    const submit = vi.fn().mockResolvedValue(undefined);
    registerSubmitter("register", submit);
    enqueueAction("register", { name: "A" }, "Registration — A");
    await flushQueue();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(getQueue()).toHaveLength(0);
  });

  it("flushQueue keeps an item and records the error on a real (non-network) rejection", async () => {
    const { enqueueAction, getQueue, flushQueue, registerSubmitter } = await import("./offlineQueue");
    const submit = vi.fn().mockRejectedValue(new Error("adjustment not found"));
    registerSubmitter("payment", submit);
    enqueueAction("payment", { amount: 100 }, "Payment — ₹100");
    await flushQueue();
    const items = getQueue();
    expect(items).toHaveLength(1);
    expect(items[0].attempts).toBe(1);
    expect(items[0].lastError).toBe("adjustment not found");
  });

  it("flushQueue stops replaying the rest of the batch on a network error, leaving items untouched", async () => {
    const { enqueueAction, getQueue, flushQueue, registerSubmitter } = await import("./offlineQueue");
    const submit = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    registerSubmitter("register", submit);
    enqueueAction("register", { name: "A" }, "Registration — A");
    enqueueAction("register", { name: "B" }, "Registration — B");
    await flushQueue();
    const items = getQueue();
    expect(items).toHaveLength(2);
    expect(items[0].attempts).toBe(0); // untouched — flushQueue broke out before recording a failed attempt
  });
});
