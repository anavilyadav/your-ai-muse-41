// Shared caller-authentication for the cron-invoked Edge Functions.
//
// WHY THIS EXISTS
// Edge Function URLs are public and guessable (.../functions/v1/<name>).
// Five functions -- whatsapp-winback, whatsapp-holiday-greetings,
// whatsapp-birthday-anniversary, whatsapp-daily-reminders and
// nightly-data-health -- were written as `Deno.serve(async () => {...})`:
// they never looked at the request at all, so ANY request to the URL ran a
// full send. Anyone who learned a URL could blast WhatsApp messages to
// every consenting patient in the database, repeatedly, on the clinic's
// AiSensy credits. `verify_jwt` is a per-function Dashboard toggle that
// nobody can verify from the repo, so this does not rely on it: the check
// lives in the function code, where it is reviewable.
//
// backup-to-sheets and backup-storage-to-drive already do exactly this with
// BACKUP_FUNCTION_SECRET / x-backup-secret. This module is that same proven
// pattern, factored out so the remaining functions share one implementation
// instead of five copy-pasted ones that can drift.
//
// SECRET
//   CRON_FUNCTION_SECRET -- Edge Function secret; the cron job sends the
//   same value back in the x-cron-secret header. Migration 0023 writes the
//   header into every cron command without ever putting the value in git.
//
// FAIL-CLOSED: if CRON_FUNCTION_SECRET is not configured, every request is
// rejected. An unset secret must never mean "let everyone in" -- that is
// the exact failure mode this is here to prevent.

// Compares in constant time so response latency can't leak the secret one
// byte at a time. Same helper backup-to-sheets already uses.
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Returns a 401 Response when the caller is not the cron job, or null when
 * the caller is authorised and the function should proceed.
 *
 * Usage:
 *   Deno.serve(async (req) => {
 *     const denied = requireCronSecret(req);
 *     if (denied) return denied;
 *     ...
 *   });
 */
export function requireCronSecret(req: Request): Response | null {
  const expected = Deno.env.get("CRON_FUNCTION_SECRET");
  const got = req.headers.get("x-cron-secret") ?? "";
  if (!expected) {
    console.error(
      "CRON_FUNCTION_SECRET is not configured — refusing to run. Set it in Edge Function secrets, then run migration 0023.",
    );
    return new Response(
      JSON.stringify({ error: "Unauthorized: CRON_FUNCTION_SECRET not configured" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!constantTimeEqual(got, expected)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
