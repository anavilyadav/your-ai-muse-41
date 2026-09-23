-- 0069 — Drop the legacy users.pin column (23 Sep 2026)
--
-- Found during a full-project security audit: users.pin held the Owner's
-- real login PIN in plain text ("1234"), and `users_staff_read` (SELECT,
-- qual true, granted to `authenticated`) let ANY logged-in staff member —
-- Reception, Pharmacy, Case-DR, Doctor — read it directly:
--   select mobile, pin from users where role = 'OWNER';
-- would have handed back Dr. Yadav's real credential to the lowest-trust
-- role in the app, unlocking every Owner-only screen RLS otherwise
-- correctly gates (staff management, settings, financial reports,
-- incentive splits).
--
-- The column is dead: the real login secret lives in Supabase Auth's own
-- hashed password store (src/lib/auth.tsx's signIn/signInDirect both call
-- supabase.auth.signInWithPassword({ email, password: pin }) — verified
-- zero code path in src/ or supabase/functions/ ever reads or writes
-- users.pin). It's a leftover from before the Supabase-Auth-password
-- migration (0043, per a comment in auth.tsx) that nothing ever cleaned
-- up. Dropping it removes the exposure permanently instead of just
-- nulling the data (which would leave the same landmine for the next
-- staff account created with a pin value by mistake).
--
-- Also drops the redundant "Allow login check" policy (SELECT, qual
-- true, roles {anon, authenticated}) — 0043 already moved to requiring
-- an authenticated session to read `users` (confirmed live: no GRANT
-- SELECT to anon currently exists, so this policy is inert today), but
-- leaving it in place means a future migration that ever grants anon
-- SELECT on this table would instantly expose every staff row with zero
-- authentication. Login itself goes through the staff-signin edge
-- function (service-role), which never needed this policy.

alter table public.users drop column if exists pin;

drop policy if exists "Allow login check" on public.users;

insert into schema_migrations (filename, notes) values
  ('0069_drop_exposed_users_pin_column', 'Drops users.pin (legacy plaintext PIN, was readable by any authenticated staff member via users_staff_read — real credential lives in Supabase Auth, this column was dead) and the redundant anon-facing "Allow login check" SELECT policy')
on conflict (filename) do nothing;
