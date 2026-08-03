// Minimal Supabase test double.
//
// Purpose: let db.ts functions be exercised for real — including their
// RPC-missing fallback paths — without touching the live clinic database.
// Deliberately not a full PostgREST emulator: it records what was called
// and returns whatever result the test configured for that RPC/table.

import { vi } from "vitest";

export interface MockResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number;
}

export interface RpcCall {
  name: string;
  args: unknown;
}
export interface TableCall {
  table: string;
  op: string;
  payload?: unknown;
}

export function createSupabaseMock(opts: {
  rpc?: Record<string, MockResult>;
  table?: Record<string, MockResult>;
} = {}) {
  const rpcCalls: RpcCall[] = [];
  const tableCalls: TableCall[] = [];

  const WRITE_OPS = new Set(["insert", "update", "delete", "upsert"]);

  function builder(table: string) {
    const result: MockResult = opts.table?.[table] ?? { data: null, error: null, count: 0 };
    const chain: any = new Proxy(function noop() {} as any, {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: MockResult) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          const op = String(prop);
          if (WRITE_OPS.has(op)) tableCalls.push({ table, op, payload: args[0] });
          return chain;
        };
      },
      apply() {
        return chain;
      },
    });
    return chain;
  }

  const client = {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn(async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return opts.rpc?.[name] ?? { data: null, error: { message: `function ${name} does not exist`, code: "42883" } };
    }),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
  };

  return { client, rpcCalls, tableCalls };
}

/** Did anything write a degraded-mode row to system_alerts? */
export function degradedAlerts(tableCalls: TableCall[]): TableCall[] {
  return tableCalls.filter((c) => c.table === "system_alerts" && c.op === "insert");
}
