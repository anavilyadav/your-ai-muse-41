// Proxies staff sign-in through the server so a lockout policy can be
// enforced (audit P1-14: PIN was as short as 4 digits with zero
// brute-force protection — the client called supabase.auth.signInWithPassword
// directly, which has no app-level lockout of its own).
//
// Policy (Dr. Yadav's decision, 29 Jul 2026): 6-digit minimum PIN,
// 5 failed attempts -> 15 minute lockout, per mobile number.
//
// Called with: { mobile, pin }
// Returns: { access_token, refresh_token } on success, or { error, locked?, retryAfterSeconds? }

import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Browsers send a preflight for the JSON POST below; without these headers
// the request never reaches this function and the app just sees "Failed to
// fetch" (which the login screen showed as "Network issue").
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }
  try {
    const { mobile, pin } = await req.json();
    const cleaned = String(mobile ?? "").replace(/\D/g, "");
    if (cleaned.length !== 10 || !pin || String(pin).length < 4) {
      return json({ error: "Mobile ya PIN galat hai" }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- Lockout check (server-side, so it can't be bypassed by calling
    // Supabase Auth directly the way the old client-side flow did) ----
    const { data: attemptRow } = await supabaseAdmin
      .from("login_attempts")
      .select("failed_count, locked_until")
      .eq("mobile", cleaned)
      .maybeSingle();

    if (attemptRow?.locked_until && new Date(attemptRow.locked_until).getTime() > Date.now()) {
      const retryAfterSeconds = Math.ceil((new Date(attemptRow.locked_until).getTime() - Date.now()) / 1000);
      return json({ error: "Bahut zyada galat attempts — thodi der baad try karo", locked: true, retryAfterSeconds }, 429);
    }

    // ---- Look up the real email for this mobile (same logic the client used to do) ----
    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("email")
      .eq("mobile", cleaned)
      .maybeSingle();
    const email = profile?.email || `${cleaned}@yhcos.in`;

    // ---- Attempt the real sign-in (anon key — this is exactly what the
    // client used to do, just proxied through here so we can gate it) ----
    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: signInData, error: signInError } = await supabaseAnon.auth.signInWithPassword({ email, password: pin });

    if (signInError || !signInData?.session) {
      const newCount = (attemptRow?.failed_count ?? 0) + 1;
      const lockingNow = newCount >= MAX_ATTEMPTS;
      await supabaseAdmin.from("login_attempts").upsert({
        mobile: cleaned,
        failed_count: lockingNow ? 0 : newCount, // reset counter once a lockout is issued, so it starts fresh after the lockout expires
        locked_until: lockingNow ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null,
        updated_at: new Date().toISOString(),
      });
      if (lockingNow) {
        return json({ error: `${MAX_ATTEMPTS} galat attempts — ${LOCKOUT_MINUTES} minute ke liye lock ho gaya`, locked: true, retryAfterSeconds: LOCKOUT_MINUTES * 60 }, 429);
      }
      return json({ error: "Mobile ya PIN galat hai" }, 401);
    }

    // ---- Success: clear any attempt history for this mobile ----
    if (attemptRow) {
      await supabaseAdmin.from("login_attempts").delete().eq("mobile", cleaned);
    }

    return json({
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
