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
export const startInstance = createStart(() => ({
  functionMiddleware: [],
  requestMiddleware: [errorMiddleware],
}));
