// Patient-record integrity + medicine master suite (26 Aug 2026).
//
// Covers the two edit paths where a mistake is expensive and invisible:
//   - a contact edit that quietly points two patient records at the same
//     mobile (every WhatsApp/lookup flow is keyed on that number), and
//   - a medicine rename that leaves branch stock filed under a name nobody
//     can search for anymore.

import { describe, it, expect, vi } from "vitest";
import { createSupabaseMock, type MockResult } from "../test/supabase-mock";

const state: { mock: ReturnType<typeof createSupabaseMock> } = {
  mock: createSupabaseMock(),
};

vi.mock("./supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./supabase")>();
  return {
    ...actual,
    supabase: new Proxy({} as any, {
      get: (_t, prop) => (state.mock.client as any)[prop],
    }),
  };
});

function setup(
  opts: { rpc?: Record<string, MockResult | ((args: any) => MockResult)>; table?: Record<string, MockResult> } = {},
) {
  state.mock = createSupabaseMock(opts);
  return state.mock;
}

describe("updatePatientContactInfo", () => {
  it("refuses a mobile already registered on another patient", async () => {
    const m = setup({ table: { patients: { data: { id: "other-patient" }, error: null } } });
    const { updatePatientContactInfo } = await import("./db");
    const res = await updatePatientContactInfo("p-1", { mobile: "9876543210" });

    expect(res.success).toBe(false);
    expect(res.patient).toBeNull();
    // Nothing may be written once the duplicate is detected.
    expect(m.tableCalls.filter((c) => c.table === "patients" && c.op === "update")).toHaveLength(0);
  });

  it("allows the edit when the number is free", async () => {
    const m = setup({ table: { patients: { data: null, error: null } } });
    const { updatePatientContactInfo } = await import("./db");
    await updatePatientContactInfo("p-1", { mobile: "9876543210" });
    expect(m.tableCalls.some((c) => c.table === "patients" && c.op === "update")).toBe(true);
  });

  it("skips the duplicate check entirely when the mobile isn't being changed", async () => {
    // An address-only correction must not be blocked by an unrelated
    // lookup, and must not cost an extra round trip.
    const m = setup({ table: { patients: { data: { id: "p-1" }, error: null } } });
    const { updatePatientContactInfo } = await import("./db");
    const res = await updatePatientContactInfo("p-1", { address: "New address", city: "Jaipur" });
    expect(res.success).toBe(true);
    expect(m.tableCalls.filter((c) => c.table === "patients" && c.op === "select")).toHaveLength(0);
  });

  it("passes the edited fields through to the row unchanged", async () => {
    const m = setup({ table: { patients: { data: { id: "p-1" }, error: null } } });
    const { updatePatientContactInfo } = await import("./db");
    await updatePatientContactInfo("p-1", { city: "Jaipur", pincode: "302019" });
    const update = m.tableCalls.find((c) => c.table === "patients" && c.op === "update")!;
    expect(update.payload).toMatchObject({ city: "Jaipur", pincode: "302019" });
  });
});

describe("family links", () => {
  it("refuses to link a patient to themselves", async () => {
    const m = setup({ table: { family_links: { error: null } } });
    const { linkFamilyMember } = await import("./db");
    const res = await linkFamilyMember("p-1", "p-1", "Brother");
    expect(res.success).toBe(false);
    expect(m.tableCalls).toHaveLength(0);
  });

  it("upserts on the pair, so re-linking an existing relation isn't a duplicate-key error", async () => {
    const m = setup({ table: { family_links: { error: null } } });
    const { linkFamilyMember } = await import("./db");
    const res = await linkFamilyMember("p-1", "p-2", "Brother");
    expect(res.success).toBe(true);
    expect(m.tableCalls.find((c) => c.table === "family_links")?.op).toBe("upsert");
  });
});

describe("medicine master catalog", () => {
  it("treats a duplicate name as success and returns the existing medicine", async () => {
    // Adding "Arnica" when Arnica already exists is not a user error.
    let call = 0;
    setup({
      table: {
        medicines: () => {
          call++;
          return call === 1
            ? { data: null, error: { code: "23505", message: "duplicate key" } }
            : { data: { id: "m-1", name: "Arnica", is_active: true }, error: null };
        },
      } as any,
    });
    const { addMedicineToCatalog } = await import("./db");
    const res = await addMedicineToCatalog("Arnica");
    expect(res.success).toBe(true);
    expect(res.medicine?.id).toBe("m-1");
  });

  it("rejects a blank name without hitting the database", async () => {
    const m = setup({ table: { medicines: { data: null, error: null } } });
    const { addMedicineToCatalog } = await import("./db");
    const res = await addMedicineToCatalog("   ");
    expect(res.success).toBe(false);
    expect(m.tableCalls).toHaveLength(0);
  });

  it("trims the name so ' Arnica ' and 'Arnica' can't both exist", async () => {
    const m = setup({ table: { medicines: { data: { id: "m-1", name: "Arnica", is_active: true }, error: null } } });
    const { addMedicineToCatalog } = await import("./db");
    await addMedicineToCatalog("  Arnica  ");
    expect(m.tableCalls.find((c) => c.op === "insert")?.payload).toEqual({ name: "Arnica" });
  });

  it("cascades a rename onto live inventory rows so branch stock stays findable", async () => {
    const m = setup({ table: { medicines: { error: null }, inventory: { error: null } } });
    const { renameMedicineInCatalog } = await import("./db");
    const res = await renameMedicineInCatalog("m-1", "Arnica Mont", "Arnica Montana");

    expect(res.success).toBe(true);
    const invUpdate = m.tableCalls.find((c) => c.table === "inventory" && c.op === "update")!;
    expect(invUpdate.payload).toMatchObject({ medicine_name: "Arnica Montana" });
  });

  it("does not touch inventory when the name hasn't actually changed", async () => {
    const m = setup({ table: { medicines: { error: null }, inventory: { error: null } } });
    const { renameMedicineInCatalog } = await import("./db");
    await renameMedicineInCatalog("m-1", "Arnica", " Arnica ");
    expect(m.tableCalls.filter((c) => c.table === "inventory")).toHaveLength(0);
  });

  it("returns a human message (not raw SQL) when the new name is already taken", async () => {
    setup({ table: { medicines: { error: { code: "23505", message: "duplicate key value violates unique constraint" } } } });
    const { renameMedicineInCatalog } = await import("./db");
    const res = await renameMedicineInCatalog("m-1", "Arnica", "Nux Vomica");
    expect(res.success).toBe(false);
    expect(res.error).not.toMatch(/unique constraint/);
  });

  it("does not rename inventory when the catalog rename itself failed", async () => {
    const m = setup({ table: { medicines: { error: { message: "denied" } }, inventory: { error: null } } });
    const { renameMedicineInCatalog } = await import("./db");
    await renameMedicineInCatalog("m-1", "Arnica", "Nux Vomica");
    expect(m.tableCalls.filter((c) => c.table === "inventory")).toHaveLength(0);
  });

  it("deactivating a medicine only flips the flag — it never deletes stock history", async () => {
    const m = setup({ table: { medicines: { error: null } } });
    const { setMedicineActive } = await import("./db");
    const res = await setMedicineActive("m-1", false);
    expect(res.success).toBe(true);
    const call = m.tableCalls.find((c) => c.table === "medicines")!;
    expect(call.op).toBe("update");
    expect(call.payload).toMatchObject({ is_active: false });
    expect(m.tableCalls.some((c) => c.op === "delete")).toBe(false);
  });
});
