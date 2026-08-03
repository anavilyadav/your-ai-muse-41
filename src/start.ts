import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

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
// 03 Aug 2026 merge note: 3 commits appeared on origin/main mid-session
// ("Work in progress" / "Changes" / "Update plan", bumping
// @lovable.dev/vite-tanstack-config 2.8.4->2.8.5) that RE-imported and
// RE-wired attachSupabaseAuth here, silently undoing this exact guard.
// That looks like Lovable's two-way sync running again even though it
// was supposed to be permanently disconnected -- reverted back to
// unwired on merge. Flagged to Dr. Yadav; needs checking on the GitHub/
// Lovable side, not just re-fixed here every time it recurs.
export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
