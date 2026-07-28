import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ViewAsBanner, BackupDoctorBanner } from "@/components/yhc/RoleSwitcher";
import { InstallPrompt } from "@/components/yhc/InstallPrompt";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#1A2A41" },
      { title: "Yadav Homeo Clinic, Jaipur" },
      { name: "description", content: "Clinical operations app for Yadav Homeo Clinic, Jaipur." },
      { property: "og:title", content: "Yadav Homeo Clinic, Jaipur" },
      { property: "og:description", content: "Clinical operations app for Yadav Homeo Clinic, Jaipur." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// ----------------------------------------------------------------------------
// Global default-deny guard (audit P1-16).
//
// Before this: auth was enforced per-route by each route wrapping its own
// component in <AuthGate>. That works, but it depends on every future route
// remembering to do it — a new route file that forgets AuthGate rendered
// wide open to anyone, logged in or not. 20 routes were found missing it
// in an earlier audit pass and fixed one-by-one; this closes the class of
// bug so the *next* forgotten route fails safe instead of failing open.
//
// This is a backstop, not a replacement for AuthGate: it only enforces
// "must be logged in" for every route except the explicit public allowlist.
// Role-specific access (allow=["OWNER"] etc.) still lives in each route's
// own <AuthGate> — a logged-in Reception user hitting a route that forgot
// AuthGate would still see it render here, just not an anonymous visitor.
// ----------------------------------------------------------------------------
const PUBLIC_PATHS = ["/login"];

function GlobalAuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const isPublic = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    if (isPublic || loading || user) return;
    navigate({ to: "/login", replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublic, loading, user, pathname, navigate]);

  if (isPublic) return <>{children}</>;
  if (loading) {
    return (
      <div className="min-h-screen w-full bg-background grid place-items-center">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="min-h-screen w-full bg-background grid place-items-center">
        <div className="text-sm text-muted-foreground">Redirecting…</div>
      </div>
    );
  }
  return <>{children}</>;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ViewAsBanner />
        <BackupDoctorBanner />
        <GlobalAuthGuard>
          <Outlet />
        </GlobalAuthGuard>
        <InstallPrompt />
        <Toaster position="top-center" richColors />
      </AuthProvider>
    </QueryClientProvider>
  );
}
