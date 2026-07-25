// Supabase Edge Function — creates the Auth login (email+password) for a
// staff profile that already exists in the "users" table.
//
// WHY THIS EXISTS: creating a Supabase Auth user requires the service-role
// key, which must never be shipped to the browser. This function holds that
// key server-side. Deploy once, then call it after Add Staff.
//
// DEPLOY (one-time):
//   supabase functions deploy create-staff-login
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service role key from
//     Supabase Dashboard → Project Settings → API>
//
// CALL from the app (already wired in owner.staff.tsx's AddStaffModal — see
// the callCreateLogin() TODO there):
//   POST /functions/v1/create-staff-login  { mobile: "9876543210", pin: "1234" }

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  try {
    const { mobile, pin } = await req.json();
    if (!mobile || !pin || String(mobile).length !== 10 || String(pin).length < 4) {
      return new Response(JSON.stringify({ error: "Valid 10-digit mobile and 4+ digit PIN required" }), { status: 400 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const email = `${mobile}@yhcos.in`;
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: pin,
      email_confirm: true,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    }

    // Link the new auth user's id to the existing profile row in "users"
    // (matched by mobile) so id's match for RLS/queries going forward.
    await supabaseAdmin.from("users").update({ id: data.user.id }).eq("mobile", mobile);

    return new Response(JSON.stringify({ success: true, userId: data.user.id }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
