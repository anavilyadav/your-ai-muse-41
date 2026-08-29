import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AuthGate, LoadingBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { RoleShell, Badge } from "@/components/yhc/RoleShell";
import { fetchAuditLog, diffAuditFields, auditRowLabel, AUDIT_TABLES, type AuditLogEntry } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/audit-log")({
  head: () => ({ meta: [{ title: "Audit Log — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <AuditLogPage />
    </AuthGate>
  ),
});

type ActionFilter = "all" | "INSERT" | "UPDATE" | "DELETE";

const ACTION_LABEL: Record<ActionFilter, string> = {
  all: "Sab",
  INSERT: "Naya",
  UPDATE: "Update",
  DELETE: "Delete",
};

function AuditLogPage() {
  const [table, setTable] = useState<string>("all");
  const [action, setAction] = useState<ActionFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const log = useQuery({
    queryKey: ["audit-log", table, action],
    queryFn: () =>
      fetchAuditLog({
        table: table === "all" ? undefined : table,
        action: action === "all" ? undefined : action,
        limit: 150,
      }),
  });

  return (
    <RoleShell wide title="Audit Log" subtitle="Har change ka full record — sirf Owner ko dikhta hai" showBack>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(["all", "INSERT", "UPDATE", "DELETE"] as ActionFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setAction(f)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold border",
              action === f ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-muted-foreground border-border",
            )}
          >
            {ACTION_LABEL[f]}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 overflow-x-auto mt-2 pb-1">
        <button
          onClick={() => setTable("all")}
          className={cn(
            "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold border",
            table === "all" ? "bg-accent text-accent-foreground border-accent" : "bg-surface text-muted-foreground border-border",
          )}
        >
          Sab tables
        </button>
        {AUDIT_TABLES.map((t) => (
          <button
            key={t}
            onClick={() => setTable(t)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold border",
              table === t ? "bg-accent text-accent-foreground border-accent" : "bg-surface text-muted-foreground border-border",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {log.isLoading ? (
        <div className="mt-3"><LoadingBlock label="Audit log load ho raha hai…" /></div>
      ) : log.isError ? (
        <div className="mt-3"><ErrorBlock error={log.error} onRetry={() => void log.refetch()} /></div>
      ) : (
        <ul className="mt-3 space-y-2">
          {(log.data ?? []).map((entry) => (
            <AuditRow key={entry.id} entry={entry} expanded={expanded === entry.id} onToggle={() => setExpanded(expanded === entry.id ? null : entry.id)} />
          ))}
          {log.data && log.data.length === 0 && (
            <div className="text-center text-[12px] text-muted-foreground py-8">Koi record nahi mila</div>
          )}
        </ul>
      )}
    </RoleShell>
  );
}

function AuditRow({ entry, expanded, onToggle }: { entry: AuditLogEntry; expanded: boolean; onToggle: () => void }) {
  const isLegacyStockIssue = entry.action === "STOCK_ISSUE";
  const diffs = isLegacyStockIssue ? [] : diffAuditFields(entry);
  const tone = entry.action === "DELETE" ? "destructive" : entry.action === "INSERT" ? "success" : "primary";
  const actorLabel = entry.users?.name ?? (entry.actor_role ? entry.actor_role : "System");

  return (
    <li className="rounded-xl bg-surface border border-border p-3">
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-primary truncate">{auditRowLabel(entry)}</div>
            <div className="text-[11px] text-muted-foreground">
              {entry.table_name} • {actorLabel}
            </div>
          </div>
          <Badge tone={tone as any}>{isLegacyStockIssue ? "Stock Issue" : entry.action}</Badge>
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">
          {new Date(entry.created_at).toLocaleString("en-IN")}
          {(diffs.length > 0 || isLegacyStockIssue) && (
            <span className="ml-2 text-primary font-semibold">{expanded ? "chhupao ▲" : "detail dekho ▼"}</span>
          )}
        </div>
      </button>

      {expanded && isLegacyStockIssue && entry.new_value && (
        <div className="mt-2 rounded-lg bg-destructive/10 border border-destructive/30 p-2 text-[11px] text-primary">
          {entry.new_value}
        </div>
      )}

      {expanded && diffs.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {diffs.map((d) => (
            <div key={d.field} className="rounded-lg bg-background border border-border p-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{d.field}</div>
              <div className="text-[11px] text-destructive line-through truncate">{formatVal(d.before)}</div>
              <div className="text-[11px] text-success truncate">{formatVal(d.after)}</div>
            </div>
          ))}
        </div>
      )}

      {expanded && entry.action === "INSERT" && entry.new_data && (
        <div className="mt-2 rounded-lg bg-background border border-border p-2 text-[11px] text-primary">
          {Object.entries(entry.new_data)
            .filter(([, v]) => v !== null && v !== "")
            .slice(0, 12)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 py-0.5">
                <span className="text-muted-foreground">{k}</span>
                <span className="truncate max-w-[60%]">{formatVal(v)}</span>
              </div>
            ))}
        </div>
      )}

      {expanded && entry.action === "DELETE" && entry.old_data && (
        <div className="mt-2 rounded-lg bg-destructive/10 border border-destructive/30 p-2 text-[11px] text-primary">
          {Object.entries(entry.old_data)
            .filter(([, v]) => v !== null && v !== "")
            .slice(0, 12)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 py-0.5">
                <span className="text-muted-foreground">{k}</span>
                <span className="truncate max-w-[60%]">{formatVal(v)}</span>
              </div>
            ))}
        </div>
      )}
    </li>
  );
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
