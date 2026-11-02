-- 0114 — Data Changes report: everything (2 Nov 2026, "DATA CHANGES PAGE ME SAB DIKHAO")
--
-- Same function as 0106, plus every other bundle applied since:
--   new_patients  — patients created from the daily sheet (R2 HIGH, R2 MEDIUM, NAYA PATIENT)
--   imports       — sheet visits that were missing and got added (R4 … R4E, R3 CHECK D, NAYA PATIENT)
--   card_changes  — R2 / R2 MEDIUM: new card for the same person, old card kept in old_cards
--   merges        — now every merged record (M1, R1, R5, R5 MEDIUM, M1 MEDIUM, and ones merged in the app),
--                   read from the "MERGED into <id>" note merge_patients_atomic writes
--   double_entries — R3 CHECK B: same sheet line twice in the app (converted / spare copy deleted)
--   family_links  — R3 CHECK D (Kosha Jain family)
--   ay_paytm      — 0113: historical AY PAYTM payments moved CASH -> AY PAYTM, per patient

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
    ),
    'merges', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'primary_id', p.id, 'primary_name', p.name,
        'primary_card', coalesce(nullif(concat_ws('-', p.card_series, p.card_register, p.card_number), ''), p.patient_code),
        'duplicate_name', d.name,
        'duplicate_card', coalesce(nullif(concat_ws('-', d.card_series, d.card_register, d.card_number), ''), d.patient_code),
        'applied_at', x.merged_on,
        'bundle', case
          when exists (select 1 from dq_m1_merges m where m.duplicate_id = d.id) then 'M1'
          when exists (select 1 from dq_r1_patient_backup b where b.id = d.id) then 'R1'
          when exists (select 1 from dq_r5_plan r where r.merge_id = d.id) then 'R5'
          when exists (select 1 from dq_r5m_plan r where r.merge_id = d.id) then 'R5 MEDIUM'
          when exists (select 1 from dq_m1m_plan r where r.merge_id = d.id) then 'M1 MEDIUM'
          else 'App se' end
      ) order by x.merged_on desc, p.name), '[]'::jsonb)
      from patients d
      cross join lateral (select substring(d.notes from 'MERGED into ([0-9a-f-]{36})')::uuid as into_id,
                                 substring(d.notes from 'MERGED into [0-9a-f-]{36} on (\d{4}-\d\d-\d\d)') as merged_on) x
      join patients p on p.id = x.into_id
      where d.notes ~ 'MERGED into [0-9a-f-]{36}'
    ),
    'new_patients', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'patient_id', p.id, 'name', p.name, 'mobile', p.mobile, 'bundle', n.bundle, 'applied_at', p.created_at,
        'card', coalesce(nullif(concat_ws('-', p.card_series, p.card_register, p.card_number), ''), p.patient_code),
        'merged', p.is_deleted,
        'visits', (select count(*) from visits v where v.patient_id = p.id and not v.is_deleted)
      ) order by p.created_at desc, p.name), '[]'::jsonb)
      from (
        select patient_id, 'R2' as bundle from dq_r2_plan where kind = 'NEW_PATIENT' and applied
        union all select patient_id, 'R2 MEDIUM' from dq_r2m_plan where kind = 'NEW_PATIENT' and applied
        union all select id, 'NAYA PATIENT' from dq_naya_patients
      ) n join patients p on p.id = n.patient_id
    ),
    'imports', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'bundle', i.bundle, 'visit_date', v.visit_date, 'amount', i.amount, 'mode', i.mode_raw, 'applied_at', v.created_at,
        'patient_id', p.id, 'name', p.name,
        'card', coalesce(nullif(concat_ws('-', p.card_series, p.card_register, p.card_number), ''), p.patient_code)
      ) order by v.visit_date desc), '[]'::jsonb)
      from (
        select visit_id, amount, mode_raw, 'R4' as bundle from dq_r4_plan where status = 'INSERTED'
        union all select visit_id, amount, mode_raw, 'R4 B' from dq_r4b_plan where status = 'INSERTED'
        union all select visit_id, amount, mode_raw, 'R4 C' from dq_r4c_plan where status = 'INSERTED'
        union all select visit_id, amount, mode_raw, 'R4 D' from dq_r4d_plan where status = 'INSERTED'
        union all select visit_id, amount, mode_raw, 'R4 E' from dq_r4e_plan where status = 'INSERTED'
        union all select visit_id, amount, mode_raw, 'R3 CHECK' from dq_r3c_dplan where status = 'INSERTED'
        union all select visit_id, amount, mode_raw, 'NAYA PATIENT' from dq_naya_imports where status = 'INSERTED'
      ) i
      join visits v on v.id = i.visit_id and not v.is_deleted
      join patients p on p.id = v.patient_id
    ),
    'card_changes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'patient_id', p.id, 'name', p.name, 'kind', c.kind, 'bundle', c.bundle,
        'sheet_card', concat_ws('-', c.s, c.r, c.n),
        'before_card', nullif(concat_ws('-', b.card_series, b.card_register, b.card_number), ''),
        'card', coalesce(nullif(concat_ws('-', p.card_series, p.card_register, p.card_number), ''), p.patient_code),
        'old_cards', coalesce(to_jsonb(p.old_cards), '[]'::jsonb),
        'applied_at', b.backed_up_at
      ) order by p.name), '[]'::jsonb)
      from (
        select kind, patient_id, s, r, n, 'R2' as bundle from dq_r2_plan where kind <> 'NEW_PATIENT' and applied
        union all select kind, patient_id, s, r, n, 'R2 MEDIUM' from dq_r2m_plan where kind <> 'NEW_PATIENT' and applied
      ) c
      join patients p on p.id = c.patient_id
      left join lateral (
        select * from (
          select id, card_series, card_register, card_number, backed_up_at from dq_r2_patient_backup where c.bundle = 'R2'
          union all select id, card_series, card_register, card_number, backed_up_at from dq_r2m_patient_backup where c.bundle = 'R2 MEDIUM'
        ) bb where bb.id = c.patient_id order by bb.backed_up_at limit 1
      ) b on true
    ),
    'double_entries', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action', f.action, 'visit_date', coalesce(v.visit_date, vb.visit_date), 'slip', f.slip, 'amount', f.amount,
        'patient_id', h.id, 'name', h.name,
        'card', coalesce(nullif(concat_ws('-', h.card_series, h.card_register, h.card_number), ''), h.patient_code),
        'copy_on_id', cp.id, 'copy_on_name', cp.name
      ) order by coalesce(v.visit_date, vb.visit_date) desc), '[]'::jsonb)
      from dq_r3c_bfix f
      join patients h on h.id = f.holder_id
      left join visits v on v.id = f.visit_id
      left join lateral (select * from dq_r3c_visit_backup b where b.id = f.visit_id order by b.backed_up_at limit 1) vb on true
      left join patients cp on cp.id = vb.patient_id
    ),
    'family_links', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'patient_id', a.id, 'name', a.name,
        'card', coalesce(nullif(concat_ws('-', a.card_series, a.card_register, a.card_number), ''), a.patient_code),
        'related_id', b.id, 'related_name', b.name,
        'related_card', coalesce(nullif(concat_ws('-', b.card_series, b.card_register, b.card_number), ''), b.patient_code),
        'relationship', l.relationship, 'bundle', 'R3 CHECK'
      ) order by b.name), '[]'::jsonb)
      from dq_r3c_links l join patients a on a.id = l.patient_id join patients b on b.id = l.related_patient_id
    ),
    'ay_paytm', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'patient_id', p.id, 'name', p.name,
        'card', coalesce(nullif(concat_ws('-', p.card_series, p.card_register, p.card_number), ''), p.patient_code),
        'count', g.n, 'amount', g.amt, 'old_mode', g.old_mode, 'new_mode', g.new_mode, 'applied_at', g.at
      ) order by g.n desc, p.name), '[]'::jsonb)
      from (
        select pay.patient_id, count(*) n, sum(pay.amount_received) amt, min(b.backed_up_at) at,
               string_agg(distinct b.old_payment_mode, ', ') old_mode, string_agg(distinct pay.payment_mode, ', ') new_mode
        from dq_ay_paytm_backup b join payments pay on pay.id = b.payment_id
        group by pay.patient_id
      ) g join patients p on p.id = g.patient_id
    )
  );
end;
$function$;

revoke all on function public.data_changes_report() from public, anon;
grant execute on function public.data_changes_report() to authenticated, service_role;

insert into schema_migrations (filename, notes) values
  ('0114_data_changes_everything', 'data_changes_report(): + new patients, sheet imports, R2 card changes, all merges, double entries, family links, AY PAYTM')
on conflict (filename) do nothing;
