import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { routeTree } from "./routeTree.gen";
import { readErrorMessage } from "./lib/db";

export const getRouter = () => {
  // App-wide safety net for silent failures. Reads in src/lib/db.ts now throw
  // instead of returning [], and this makes sure that even on a screen that
  // hasn't been given its own inline error state yet, a failed load produces
  // something the user can see — never a plausible-looking empty list.
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // Background refetches of already-loaded data shouldn't nag; the
        // stale rows stay on screen and the next attempt usually recovers.
        if (query.state.data !== undefined) return;
        if (typeof window === "undefined") return;
        toast.error(readErrorMessage(error), { id: String(query.queryHash) });
      },
    }),
    defaultOptions: {
      queries: {
        retry: 1,
        // A clinic tablet drops WiFi constantly; recover on reconnect rather
        // than leaving a stuck error state the staff have to reload out of.
        refetchOnReconnect: true,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
