import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// attachSupabaseAuth (Lovable's auto-generated Supabase-Cloud middleware) is
// deliberately NOT wired here. It targets a different, unused Supabase
// project via VITE_SUPABASE_URL/SUPABASE_URL, and only matters for
// createServerFn RPCs — this codebase has none. Wiring it back in without
// first fixing those env vars would re-open the "second auth session"
// exposure flagged in the 30 Jul audit.
//
// 03 Aug 2026, THIRD occurrence same day: after the merge note above was
// written and committed, one of Lovable's own auto "Changes" commits
// (653d36a, mid Block-2 security work) re-imported and re-wired
// attachSupabaseAuth here again -- same guard, silently undone a second
// time within hours, inside the same session that was hardening
// send-whatsapp and the cron functions against unauthorised callers.
// Reverted again (8df360f).
//
// 04 Aug 2026, FOURTH occurrence: re-wired yet again by one of the many
// auto "Changes" commits during the timeline/reports/Block-3 session
// (between 8df360f and 17a8535). Reverted again. Four times in two days
// is not a one-off -- the cause is on the GitHub/Lovable side (repo
// Settings -> Integrations/Webhooks for lovable.dev's GitHub App
// installation) and needs to be checked and revoked there, not just
// re-fixed here a fifth time.
export const startInstance = createStart(() => ({
  functionMiddleware: [],
  requestMiddleware: [errorMiddleware],
}));
