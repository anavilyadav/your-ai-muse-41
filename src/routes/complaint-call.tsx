import { createFileRoute, redirect } from "@tanstack/react-router";

// Folded into the unified Call Desk (25 Sep 2026, Dr. Yadav's Reception-
// flow rebuild — "call se hi sab start hota hai"). This standalone screen
// is retired; anything still linking here (bookmarks, muscle memory) lands
// on /call instead, where "Complaint" is one of the 4 tiles.
export const Route = createFileRoute("/complaint-call")({
  beforeLoad: () => {
    throw redirect({ to: "/call" });
  },
});
