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

// Browsers send a preflight OPTIONS request before the real POST below;
// without these headers the preflight itself fails (405) and the browser
// never sends the actual request — this is why every "create login" click
// from the Owner Control Centre was silently failing (confirmed live via
// edge function logs, 10 Aug 2026: repeated OPTIONS 405 on this function,
// while the sibling staff-signin function — which already had this — was
// fine). Same pattern as staff-signin.
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

// Phase 1 #5 — orphan-risk verified and fixed.
//
// When a staff member's login is first created below, users.id is
// reassigned from a placeholder id (set when the profile was added) to
// the real Supabase Auth user id. If anything was configured for that
// staff member BEFORE their login existed, it stored the OLD id — and
// silently stops matching once the id changes, with no error anywhere
// (it just quietly never fires/applies again). Verified three real spots
// in the app that persist a users.id outside the users table itself, all
// as JSON blobs in `settings`:
//   - backup_doctor_config   { userId, start, end, enabled }
//   - case_dr_levels         { [userId]: "Junior" | "Senior" }
//   - incentive_splits       { [userId]: percentageWeight }
// This repoints all three from oldId to newId in the same request that
// changes the id, so a login created after any of these were configured
// doesn't quietly break them.
//
// NOTE (flagging, not fixing today): the more structural fix would be to
// never change users.id at all -- add a separate auth_user_id column and
// have the app look up sessions by that instead. That touches the core
// auth lookup path (src/lib/auth.tsx) for every role, so it's a bigger,
// riskier change than this targeted repoint. Worth doing in a dedicated
// session if more of these userId-keyed settings show up later.
async function repointStaffId(supabaseAdmin: any, oldId: string, newId: string) {
  const { data: backupCfgRow } = await supabaseAdmin
    .from("settings").select("value").eq("key", "backup_doctor_config").maybeSingle();
  if (backupCfgRow?.value) {
    try {
      const cfg = JSON.parse(backupCfgRow.value);
      if (cfg?.userId === oldId) {
        cfg.userId = newId;
        await supabaseAdmin.from("settings").update({ value: JSON.stringify(cfg) }).eq("key", "backup_doctor_config");
      }
    } catch { /* malformed JSON already -- not this function's job to repair */ }
  }

  const { data: levelsRow } = await supabaseAdmin
    .from("settings").select("value").eq("key", "case_dr_levels").maybeSingle();
  if (levelsRow?.value) {
    try {
      const levels = JSON.parse(levelsRow.value);
      if (levels && Object.prototype.hasOwnProperty.call(levels, oldId)) {
        levels[newId] = levels[oldId];
        delete levels[oldId];
        await supabaseAdmin.from("settings").update({ value: JSON.stringify(levels) }).eq("key", "case_dr_levels");
      }
    } catch { /* malformed JSON already -- not this function's job to repair */ }
  }

  const { data: splitsRow } = await supabaseAdmin
    .from("settings").select("value").eq("key", "incentive_splits").maybeSingle();
  if (splitsRow?.value) {
    try {
      const splits = JSON.parse(splitsRow.value);
      if (splits && Object.prototype.hasOwnProperty.call(splits, oldId)) {
        splits[newId] = splits[oldId];
        delete splits[oldId];
        await supabaseAdmin.from("settings").update({ value: JSON.stringify(splits) }).eq("key", "incentive_splits");
      }
    } catch { /* malformed JSON already -- not this function's job to repair */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
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
      return json({ error: "Not signed in" }, 401);
    }
    const { data: callerAuth, error: callerErr } = await supabaseAdmin.auth.getUser(token);
    if (callerErr || !callerAuth?.user) {
      return json({ error: "Invalid or expired session" }, 401);
    }
    const { data: callerProfile } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", callerAuth.user.id)
      .maybeSingle();
    if (callerProfile?.role !== "OWNER") {
      return json({ error: "Owner access required" }, 403);
    }
    // ---- End caller verification ----

    const body = await req.json();
    const { action, mobile, email, pin } = body;

    if (!mobile || String(mobile).length !== 10) {
      return json({ error: "Valid 10-digit mobile required" }, 400);
    }

    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("id, has_login, role")
      .eq("mobile", mobile)
      .maybeSingle();

    if (!profile) {
      return json({ error: "No staff profile found for this mobile — add the staff member first" }, 404);
    }

    // Removing staff: soft-delete the profile (is_active/is_deleted, per the
    // schema's own existing columns — never a hard DELETE, since visits/
    // prescriptions/audit_log rows reference this id and losing that trail
    // would break accountability) and ban their Auth login if one exists,
    // so a removed staff member genuinely cannot sign in anymore even if
    // they still know their PIN. Owner accounts are refused here as a
    // server-side backstop — the UI already hides this action for OWNER.
    if (action === "delete") {
      if (profile.role === "OWNER") {
        return json({ error: "Owner account cannot be removed" }, 400);
      }
      const { error: delErr } = await supabaseAdmin
        .from("users")
        .update({ is_active: false, is_deleted: true })
        .eq("mobile", mobile);
      if (delErr) return json({ error: delErr.message }, 400);
      if (profile.has_login) {
        try {
          await supabaseAdmin.auth.admin.updateUserById(profile.id, { ban_duration: "87600h" });
        } catch (e) {
          // Profile is already removed either way; a ban failure (e.g. no
          // real Auth account ever existed for this id) shouldn't block that.
          console.error("Auth ban on delete failed:", e);
        }
      }
      return json({ success: true });
    }

    if (!email || !String(email).includes("@")) {
      return json({ error: "Valid email required" }, 400);
    }

    if (action === "update-email") {
      if (profile.has_login) {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.id, { email });
        if (error) return json({ error: error.message }, 400);
      }
      await supabaseAdmin.from("users").update({ email }).eq("mobile", mobile);
      return json({ success: true });
    }

    // default action: create the login
    if (!pin || String(pin).length < 6) {
      return json({ error: "6+ digit PIN required" }, 400);
    }
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: pin,
      email_confirm: true,
    });
    if (error) {
      return json({ error: error.message }, 400);
    }
    const oldId = profile.id;
    const newId = data.user.id;
    await supabaseAdmin.from("users").update({ id: newId, email, has_login: true }).eq("mobile", mobile);

    if (oldId && oldId !== newId) {
      try {
        await repointStaffId(supabaseAdmin, oldId, newId);
      } catch (e) {
        // The login itself already succeeded and matters more than these
        // secondary settings -- don't fail the request over this, but
        // don't swallow it silently either.
        console.error("repointStaffId failed:", e);
      }
    }

    return json({ success: true, userId: newId });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
