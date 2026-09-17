-- 0050 — Purchase orders (#10, Dr. Yadav's spec 04 Sep 2026)
--
-- "Purchase order staff mention krde jo chaiye wo mere pass aajaye next
-- day jab me dashboard kholu to dikh jaye or whatsapp ho jaye wahi se fir
-- jab saman aaye to jaise hi staff entry krega ki ye saman aaya hai wo
-- apne aap mere yaha pe update ho jaye ji aapne jo order kiya tha usme se
-- kitne item aagaye or kitne item pending hai"
--
-- Any staff member can raise a PO (glass bottles, globules packets,
-- medicine bottles in various sizes, envelopes, letterheads, bill books,
-- instruction pamphlets — spans both Pharmacy and Reception, so this
-- isn't PHARMA-only). Owner sees pending ones on the dashboard and gets a
-- WhatsApp ping the moment one is raised. When stock physically arrives,
-- whichever staff member receives it enters quantities against the
-- original order — status (PENDING/PARTIAL/COMPLETE) is derived, never
-- hand-set, so "kitne aaye kitne pending" can't drift from the item rows.

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  branch text,
  status text not null default 'PENDING' check (status in ('PENDING', 'PARTIAL', 'COMPLETE', 'CANCELLED')),
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_name text not null,
  quantity_requested numeric not null check (quantity_requested > 0),
  quantity_received numeric not null default 0 check (quantity_received >= 0),
  unit text,
  created_at timestamptz not null default now()
);

create index if not exists purchase_order_items_po_id_idx on public.purchase_order_items (po_id);
create index if not exists purchase_orders_status_idx on public.purchase_orders (status);

-- RLS Phase 1 pattern (see 0043_rls_core_phase1.sql) — these two tables
-- didn't exist when that migration ran, so they need the same treatment
-- applied explicitly here: close anon off entirely, full CRUD for any
-- signed-in staff member (Phase 2 row-level restriction stays deferred,
-- same decision as everywhere else).
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

revoke all on public.purchase_orders from public, anon;
revoke all on public.purchase_order_items from public, anon;
grant select, insert, update, delete on public.purchase_orders to authenticated;
grant select, insert, update, delete on public.purchase_order_items to authenticated;

drop policy if exists purchase_orders_staff_all on public.purchase_orders;
create policy purchase_orders_staff_all on public.purchase_orders for all to authenticated using (true) with check (true);
drop policy if exists purchase_order_items_staff_all on public.purchase_order_items;
create policy purchase_order_items_staff_all on public.purchase_order_items for all to authenticated using (true) with check (true);

-- Accountability trail, same convention as 0020_full_audit_log.sql.
drop trigger if exists trg_audit_purchase_orders on public.purchase_orders;
create trigger trg_audit_purchase_orders after insert or update or delete on public.purchase_orders
  for each row execute function public.audit_log_generic();
drop trigger if exists trg_audit_purchase_order_items on public.purchase_order_items;
create trigger trg_audit_purchase_order_items after insert or update or delete on public.purchase_order_items
  for each row execute function public.audit_log_generic();

-- Creates the PO and all its line items in one transaction so a partial
-- item list can never be saved. p_items: [{"item_name":"...",
-- "quantity_requested":10,"unit":"pcs"}, ...]
create or replace function create_purchase_order_atomic(
  p_branch text,
  p_notes text,
  p_items jsonb
) returns jsonb as $$
declare
  v_po_id uuid;
  v_item jsonb;
  v_count int;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Kam se kam ek item zaroori hai';
  end if;

  insert into purchase_orders (branch, notes, created_by)
  values (p_branch, p_notes, auth.uid())
  returning id into v_po_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into purchase_order_items (po_id, item_name, quantity_requested, unit)
    values (
      v_po_id,
      v_item->>'item_name',
      (v_item->>'quantity_requested')::numeric,
      v_item->>'unit'
    );
  end loop;

  select count(*) into v_count from purchase_order_items where po_id = v_po_id;
  return jsonb_build_object('po_id', v_po_id, 'item_count', v_count);
end;
$$ language plpgsql security definer set search_path to 'public';

revoke all on function create_purchase_order_atomic(text, text, jsonb) from public, anon;
grant execute on function create_purchase_order_atomic(text, text, jsonb) to authenticated, service_role;

-- Records a delivery against ONE item (row-locked so two staff entering
-- the same shipment can't double-count), then recomputes the parent PO's
-- status from the current state of ALL its items — PENDING only while
-- nothing has arrived, COMPLETE only once every item's received quantity
-- has caught up to what was requested, PARTIAL in between. Cumulative,
-- not incremental — caller passes the new running total for that item so
-- a mis-entry can be corrected by re-entering the right number.
create or replace function receive_po_item_atomic(
  p_item_id uuid,
  p_quantity_received numeric
) returns jsonb as $$
declare
  v_po_id uuid;
  v_new_status text;
begin
  if p_quantity_received < 0 then
    raise exception 'Quantity negative nahi ho sakti';
  end if;

  select po_id into v_po_id from purchase_order_items where id = p_item_id for update;
  if not found then
    raise exception 'Item nahi mila';
  end if;

  update purchase_order_items
  set quantity_received = p_quantity_received
  where id = p_item_id;

  perform 1 from purchase_order_items where po_id = v_po_id for update;

  select case
    when bool_and(quantity_received >= quantity_requested) then 'COMPLETE'
    when bool_or(quantity_received > 0) then 'PARTIAL'
    else 'PENDING'
  end into v_new_status
  from purchase_order_items
  where po_id = v_po_id;

  update purchase_orders set status = v_new_status where id = v_po_id;

  return jsonb_build_object('po_id', v_po_id, 'status', v_new_status);
end;
$$ language plpgsql security definer set search_path to 'public';

revoke all on function receive_po_item_atomic(uuid, numeric) from public, anon;
grant execute on function receive_po_item_atomic(uuid, numeric) to authenticated, service_role;
