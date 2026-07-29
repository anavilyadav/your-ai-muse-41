import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { roleHome } from "@/lib/supabase";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Login — YHC Jaipur" }, { name: "robots", content: "noindex" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { user, signIn, loading, profileLoadFailed, retryLoadProfile } = useAuth();
  const navigate = useNavigate();
  const [mobile, setMobile] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: roleHome(user.role), replace: true });
  }, [user, loading, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const err = await signIn(mobile, pin);
    setBusy(false);
    if (err) {
      toast.error(err);
      return;
    }
  };

  // Phase 1 #7: signIn() above succeeded (Supabase Auth session is real),
  // but our own profile fetch from the users table timed out on a slow
  // connection. Without this, the person is stuck looking at an unchanged
  // login form with no feedback that anything happened at all. Show what
  // actually happened instead.
  if (profileLoadFailed) {
    return (
      <div className="min-h-screen w-full bg-background flex justify-center">
        <div className="relative w-full max-w-[430px] min-h-screen bg-background flex flex-col items-center justify-center px-6 shadow-[0_0_60px_-20px_rgba(26,42,65,0.35)]">
          <div className="text-center max-w-xs">
            <div className="text-sm font-semibold text-foreground mb-1">Login ho gaya, connection slow hai</div>
            <div className="text-xs text-muted-foreground mb-4">Profile load nahi ho paya — network check karke dobara try karo.</div>
            <button
              onClick={retryLoadProfile}
              className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold"
            >
              Dobara try karo
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-background flex justify-center">
      <div className="relative w-full max-w-[430px] min-h-screen bg-background flex flex-col shadow-[0_0_60px_-20px_rgba(26,42,65,0.35)]">
        <div className="bg-primary text-primary-foreground px-5 pt-12 pb-8 rounded-b-3xl text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-accent text-accent-foreground grid place-items-center font-extrabold text-3xl">
            Y
          </div>
          <h1 className="mt-4 text-2xl font-extrabold">Yadav Homeo Clinic</h1>
          <p className="text-xs text-primary-foreground/70 mt-1">Jaipur • Staff Login</p>
        </div>

        <form onSubmit={submit} className="flex-1 px-5 py-8 space-y-4">
          <div>
            <label className="text-xs font-semibold text-primary uppercase tracking-wide">Mobile Number</label>
            <input
              inputMode="numeric"
              maxLength={10}
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="10 digit mobile"
              className="mt-1.5 w-full rounded-lg bg-surface border border-input px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-primary uppercase tracking-wide">PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="PIN"
              className="mt-1.5 w-full rounded-lg bg-surface border border-input px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-success text-success-foreground py-3.5 text-sm font-bold shadow-md active:scale-[0.99] transition disabled:opacity-60"
          >
            {busy ? "Login ho raha hai..." : "Login"}
          </button>
          <p className="text-center text-[11px] text-muted-foreground pt-2">
            YHC OS • Only registered staff. Bhool gaye PIN? Owner se milein.
          </p>
        </form>
      </div>
    </div>
  );
}
