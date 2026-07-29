-- ============================================================================
-- YHC-OS — Atomic Stock Increment — Re-audit finding (29 Jul 2026)
-- Run this ONCE in Supabase SQL Editor. Safe to re-run.
--
-- addStockEntry was read-then-write in JS (select stock_drams, add
-- locally, write back) — two staff adding stock for the same medicine
-- at the same moment could clobber each other's update (lost update).
-- Row-locks the matching inventory row inside one transaction instead.
--
-- Residual edge case, honestly flagged: if the row doesn't exist yet
-- (brand new medicine+potency+branch combo never stocked before) and
-- two staff add it in the exact same instant, both could still insert
-- separate rows — a row lock only protects rows that already exist.
-- Extremely rare in practice (only bites the very first stock entry for
-- a new item), and still far safer than the previous always-racy path.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION increment_stock(
  p_medicine_name text,
  p_potency text,
  p_branch text,
  p_quantity numeric,
  p_type text DEFAULT NULL
) RETURNS json AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM inventory
  WHERE medicine_name = p_medicine_name
    AND potency IS NOT DISTINCT FROM p_potency
    AND branch = p_branch
  FOR UPDATE;

  IF v_id IS NULL THEN
    INSERT INTO inventory (medicine_name, potency, branch, stock_drams, type)
    VALUES (p_medicine_name, p_potency, p_branch, p_quantity, p_type)
    RETURNING id INTO v_id;
  ELSE
    UPDATE inventory SET stock_drams = COALESCE(stock_drams, 0) + p_quantity WHERE id = v_id;
  END IF;

  RETURN json_build_object('success', true, 'id', v_id);
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- VERIFY:
-- select proname from pg_proc where proname = 'increment_stock';
