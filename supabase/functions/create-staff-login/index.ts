// Supabase Edge Function — creates AND updates the Auth login for staff.
// Uses REAL email addresses (not a fake @yhcos.in one) so password resets
// and account recovery actually work.
//
// Called with (Authorization: Bearer <caller's Supabase session JWT> required):
//   { action: "create", mobile, email, pin }        — first-time login setup
//   { action: "update-email", mobile, email }        — change email later
//
// SECURITY: this function uses the service-role key, which bypasses RLS
// entirely — without a caller check, anyone with the URL could create or
// take over ANY staff login (including Owner) just by knowing this
// endpoint. The block below verifies the caller's JWT is a real, signed-in
// session AND that the corresponding users row has role = 'OWNER', before
// touching anything. Every other request is rejected.

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- Caller verification: must be a signed-in OWNER ----
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Not signed in" }), { status: 401 });
    }
    const { data: callerAuth, error: callerErr } = await supabaseAdmin.auth.getUser(token);
    if (callerErr || !callerAuth?.user) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401 });
    }
    const { data: callerProfile } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", callerAuth.user.id)
      .maybeSingle();
    if (callerProfile?.role !== "OWNER") {
      return new Response(JSON.stringify({ error: "Owner access required" }), { status: 403 });
    }
    // ---- End caller verification ----

    const body = await req.json();
    const { action, mobile, email, pin } = body;

    if (!mobile || String(mobile).length !== 10) {
      return new Response(JSON.stringify({ error: "Valid 10-digit mobile required" }), { status: 400 });
    }
    if (!email || !String(email).includes("@")) {
      return new Response(JSON.stringify({ error: "Valid email required" }), { status: 400 });
    }

    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("id, has_login")
      .eq("mobile", mobile)
      .maybeSingle();

    if (!profile) {
      return new Response(JSON.stringify({ error: "No staff profile found for this mobile — add the staff member first" }), { status: 404 });
    }

    if (action === "update-email") {
      if (profile.has_login) {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.id, { email });
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
      }
      await supabaseAdmin.from("users").update({ email }).eq("mobile", mobile);
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    }

    // default action: create the login
    if (!pin || String(pin).length < 6) {
      return new Response(JSON.stringify({ error: "6+ digit PIN required" }), { status: 400 });
    }
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: pin,
      email_confirm: true,
    });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    }
    await supabaseAdmin.from("users").update({ id: data.user.id, email, has_login: true }).eq("mobile", mobile);
    return new Response(JSON.stringify({ success: true, userId: data.user.id }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
