-- ============================================================================
-- YHC-OS — Medicine Master + inventory fixes (05 Aug 2026)
-- Run ONCE in Supabase SQL Editor for swekxnhvecrcpiuteqmj. Safe to re-run
-- (every statement is idempotent — IF NOT EXISTS / ON CONFLICT guards).
--
-- WHAT THIS DOES, AND WHY (three real, live bugs found + one new feature):
--
-- BUG 1 — inventory.type column does not exist in the live DB, but
-- increment_stock() (migration 0009) and the frontend (fetchMasterMedicines,
-- addStockEntry/StockEntryInput) both read/write it. Verified live via
-- information_schema — the column was never actually created. Right now,
-- adding a genuinely NEW medicine+potency+branch combo silently fails (the
-- error is swallowed in fetchMasterMedicines, and mis-classified as "missing
-- function" — it isn't — in addStockEntry's fallback path). This migration
-- adds the missing column.
--
-- BUG 2 — inventory has RLS enabled (correctly) but only SELECT and UPDATE
-- policies exist — no INSERT policy. Verified live via pg_policies. So even
-- after Bug 1 is fixed, increment_stock's INSERT branch (for a combo that's
-- never been stocked before) would still be blocked by RLS for the
-- authenticated role. This adds the missing INSERT policy, matching the
-- exact pattern already used for patients/visits/payments/prescriptions.
--
-- BUG 3 (design gap, not a crash) — there was no separate medicine-name
-- catalog. "Master" was whatever medicine_name values happened to exist in
-- inventory rows, including phantom 0-stock rows created just to register a
-- name. This creates a real medicines table: name-only, decoupled from
-- stock/potency/branch, Owner/Pharmacy-editable, seeded with 180 standard
-- homeopathic remedies so nobody has to type a name from scratch. inventory
-- keeps tracking potency + stock + branch exactly as before — unrelated,
-- unchanged, existing dispense/increment logic is not touched.
-- ============================================================================

BEGIN;

-- ---- Bug 1: missing column ----
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS type text;

-- ---- Bug 2: missing INSERT policy ----
DROP POLICY IF EXISTS "Staff can insert inventory" ON inventory;
CREATE POLICY "Staff can insert inventory" ON inventory
  FOR INSERT TO authenticated WITH CHECK (true);

-- ---- Bug 3 / new feature: medicines master catalog ----
CREATE TABLE IF NOT EXISTS medicines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  modified_at timestamptz NOT NULL DEFAULT now(),
  modified_by uuid REFERENCES users(id)
);

-- Case-insensitive uniqueness among live (non-deleted) entries only — a
-- deactivated/deleted "Nux Vomica" shouldn't block re-adding it later.
CREATE UNIQUE INDEX IF NOT EXISTS medicines_name_unique_live
  ON medicines (lower(btrim(name)))
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS medicines_active_idx ON medicines (is_active) WHERE is_deleted = false;

ALTER TABLE medicines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view medicines" ON medicines;
CREATE POLICY "Staff can view medicines" ON medicines FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Staff can insert medicines" ON medicines;
CREATE POLICY "Staff can insert medicines" ON medicines FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Staff can update medicines" ON medicines;
CREATE POLICY "Staff can update medicines" ON medicines FOR UPDATE TO authenticated USING (true);

-- Seed: 180 standard homeopathic polychrests (Dr. Yadav's own reference
-- list, 05 Aug 2026). ON CONFLICT is safe against the case-insensitive
-- unique index above — re-running this file will not create duplicates.
INSERT INTO medicines (name) VALUES
  ('Abrotanum'),
  ('Aceticum acidum'),
  ('Aconitum napellus'),
  ('Actea racemosa'),
  ('Aesculus hippocastanum'),
  ('Aethusa cynapium'),
  ('Agaricus muscarius'),
  ('Agnus castus'),
  ('Ailanthus glandulosa'),
  ('Allium cepa'),
  ('Aloe'),
  ('Alumen'),
  ('Alumina'),
  ('Ambra grisea'),
  ('Ammonium carbonicum'),
  ('Ammonium muriaticum'),
  ('Anacardium orientale'),
  ('Antimonium crudum'),
  ('Antimonium tartaricum'),
  ('Apis mellifica'),
  ('Apocynum cannabinum'),
  ('Argentum metallicum'),
  ('Argentum nitricum'),
  ('Arnica montana'),
  ('Arsenicum album'),
  ('Arsenicum iodatum'),
  ('Arum triphyllum'),
  ('Asa foetida'),
  ('Aurum metallicum'),
  ('Aurum muriaticum'),
  ('Baptisia'),
  ('Baryta carbonica'),
  ('Baryta muriatica'),
  ('Belladonna'),
  ('Benzoicum acidum'),
  ('Berberis'),
  ('Borax'),
  ('Bromium'),
  ('Bryonia'),
  ('Bufo'),
  ('Cactus grandiflorus'),
  ('Cadmium sulfuricum'),
  ('Caladium'),
  ('Calcarea arsenicosa'),
  ('Calcarea carbonica'),
  ('Calcarea fluorica'),
  ('Calcarea phosphorica'),
  ('Calcarea sulfurica'),
  ('Camphora'),
  ('Cannabis indica'),
  ('Cannabis sativa'),
  ('Cantharis'),
  ('Capsicum'),
  ('Carbo animalis'),
  ('Carbo vegetabilis'),
  ('Carboneum sulfuratum'),
  ('Carduus marianus'),
  ('Causticum'),
  ('Chamomilla'),
  ('Chelidonium'),
  ('Chininum arsenicosum'),
  ('Cicuta virosa'),
  ('Cina'),
  ('Cinchona officinalis'),
  ('Cinnabaris'),
  ('Cistus canadensis'),
  ('Clematis erecta'),
  ('Cocculus indicus'),
  ('Coccus cacti'),
  ('Coffea cruda'),
  ('Colchicum'),
  ('Colocynthis'),
  ('Conium maculatum'),
  ('Crotalus horridus'),
  ('Croton tiglium'),
  ('Cuprum metallicum'),
  ('Cyclamen'),
  ('Digitalis purpurea'),
  ('Drosera rotundifolia'),
  ('Dulcamara'),
  ('Eupatorium perfoliatum'),
  ('Euphrasia officinalis'),
  ('Ferrum metallicum'),
  ('Ferrum phosphoricum'),
  ('Fluoricum acidum'),
  ('Gelsemium sempervirens'),
  ('Glonoinum'),
  ('Graphites'),
  ('Gratiola officinalis'),
  ('Guaiacum'),
  ('Helleborus niger'),
  ('Hepar sulfuris calcareum'),
  ('Hydrastis canadensis'),
  ('Hyoscyamus niger'),
  ('Hypericum perforatum'),
  ('Ignatia amara'),
  ('Iodum'),
  ('Ipecacuanha'),
  ('Kalium bichromicum'),
  ('Kalium carbonicum'),
  ('Kalium iodatum'),
  ('Kalium phosphoricum'),
  ('Kalium sulfuricum'),
  ('Kalmia latifolia'),
  ('Kreosotum'),
  ('Lac caninum'),
  ('Lac vaccinum defloratum'),
  ('Lachesis'),
  ('Laurocerasus'),
  ('Ledum palustre'),
  ('Lillium tigrinum'),
  ('Lycopodium clavatum'),
  ('Magnesia carbonica'),
  ('Magnesia muriatica'),
  ('Magnesia phosphorica'),
  ('Manganum'),
  ('Medorrhinum'),
  ('Mercurius solubilis'),
  ('Mercurius corrosivus'),
  ('Mercurius cyanatus'),
  ('Mercurius iodatus flavus'),
  ('Mercurius iodatus ruber'),
  ('Mercurius sulphuricus'),
  ('Mezereum'),
  ('Millefolium'),
  ('Moschus'),
  ('Muriaticum acidum'),
  ('Naja'),
  ('Natrum arsenicosum'),
  ('Natrum carbonicum'),
  ('Natrum muriaticum'),
  ('Natrum phosphoricum'),
  ('Natrum sulfuricum'),
  ('Nitricum acidum'),
  ('Nux moschata'),
  ('Nux vomica'),
  ('Opium'),
  ('Oxalicum acidum'),
  ('Petroleum'),
  ('Phosphoricum acidum'),
  ('Phosphorus'),
  ('Phytolacca decandra'),
  ('Picricum acidum'),
  ('Platina'),
  ('Plumbum metallicum'),
  ('Podophyllum peltatum'),
  ('Psorinum'),
  ('Pulsatilla nigricans'),
  ('Pyrogenium'),
  ('Ranunculus bulbosus'),
  ('Rhododendron'),
  ('Rhus toxicodendron'),
  ('Rumex crispus'),
  ('Ruta graveolens'),
  ('Sabadilla'),
  ('Sabina'),
  ('Sanguinaria canadensis'),
  ('Sarsaparilla'),
  ('Secale cornutum'),
  ('Selenium'),
  ('Senecio aureus'),
  ('Senega'),
  ('Sepia'),
  ('Silicea'),
  ('Spigelia anthelmia'),
  ('Spongia tosta'),
  ('Squilla'),
  ('Stannum metallicum'),
  ('Staphysagria'),
  ('Stramonium'),
  ('Sulfur'),
  ('Sulfuricum acidum'),
  ('Syphilinum'),
  ('Tarentula hispana'),
  ('Theridion'),
  ('Thuya occidentalis'),
  ('Tuberculinum bovinum'),
  ('Valeriana officinalis'),
  ('Veratrum album'),
  ('Zincum metallicum')
ON CONFLICT DO NOTHING;

COMMIT;

-- VERIFY:
-- select count(*) from medicines;                         -- expect 180 (or more, if staff already added some)
-- select column_name from information_schema.columns where table_name='inventory' and column_name='type';
-- select policyname from pg_policies where tablename='inventory' and cmd='INSERT';
