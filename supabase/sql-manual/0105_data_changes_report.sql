-- 0105 — Data Changes report (29 Oct 2026)
--
-- Dr. Yadav asked for one Owner page that lists every data correction made
-- from the daily-sheet cross-check bundles (B4 visit moves, B2 full names,
-- B3 cards, B1 mobiles, B6 online/courier), with before -> after. The dq_*
-- tables are locked to the API, so this Owner-only function reads them.

create or replace function public.data_changes_report()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_role text;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is distinct from 'OWNER' then
    raise exception 'permission denied: only Owner can view data changes';
  end if;

  return jsonb_build_object(
    'visits', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'bundle', m.bundle, 'applied_at', m.applied_at, 'visit_id', m.visit_id, 'visit_date', v.visit_date,
        'from_id', f.id, 'from_name', f.name, 'from_card', coalesce(nullif(concat_ws('-', f.card_series, f.card_register, f.card_number), ''), f.patient_code),
        'to_id', t.id, 'to_name', t.name, 'to_card', coalesce(nullif(concat_ws('-', t.card_series, t.card_register, t.card_number), ''), t.patient_code)
      ) order by v.visit_date desc), '[]'::jsonb)
      from dq_b4_visit_moves m
      join visits v on v.id = m.visit_id
      join patients f on f.id = m.from_patient_id
      join patients t on t.id = m.to_patient_id
      where m.applied_at is not null and m.undone_at is null
    ),
    'names', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'patient_id', c.patient_id, 'old_name', c.old_name, 'new_name', c.new_name, 'applied_at', c.applied_at,
        'card', coalesce(nullif(concat_ws('-', p.card_series, p.card_register, p.card_number), ''), p.patient_code)
      ) order by c.new_name), '[]'::jsonb)
      from dq_b2_name_changes c join patients p on p.id = c.patient_id
      where c.applied_at is not null
    ),
    'cards', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'patient_id', c.patient_id, 'name', p.name, 'applied_at', c.applied_at,
        'card', concat_ws('-', c.card_series, c.card_register, c.card_number)
      ) order by p.name), '[]'::jsonb)
      from dq_b3_card_fills c join patients p on p.id = c.patient_id
      where c.applied_at is not null
    ),
    'mobiles', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'patient_id', c.patient_id, 'name', p.name, 'mobile', c.mobile, 'applied_at', c.applied_at,
        'card', coalesce(nullif(concat_ws('-', p.card_series, p.card_register, p.card_number), ''), p.patient_code)
      ) order by p.name), '[]'::jsonb)
      from dq_b1_mobile_fills c join patients p on p.id = c.patient_id
      where c.applied_at is not null
    ),
    'flags', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'patient_id', c.patient_id, 'name', p.name, 'source', c.source, 'applied_at', c.applied_at,
        'card', coalesce(nullif(concat_ws('-', p.card_series, p.card_register, p.card_number), ''), p.patient_code)
      ) order by p.name), '[]'::jsonb)
      from dq_b6_flag_changes c join patients p on p.id = c.patient_id
      where c.applied_at is not null
    )
  );
end;
$function$;

revoke all on function public.data_changes_report() from public, anon;
grant execute on function public.data_changes_report() to authenticated, service_role;

insert into schema_migrations (filename, notes) values
  ('0105_data_changes_report', 'data_changes_report(): Owner-only list of applied data-quality bundle changes (B4/B2/B3/B1/B6)')
on conflict (filename) do nothing;
