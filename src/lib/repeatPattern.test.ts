import { describe, it, expect } from "vitest";
import { describeRepeatPattern } from "./db";

const at = (date: string, disease: string) => ({ date: `${date}T10:00:00Z`, disease });

describe("describeRepeatPattern", () => {
  it("returns null for a single search", () => {
    expect(describeRepeatPattern([at("2026-01-01", "Neurologists")])).toBeNull();
  });

  it("flags searching the clinic's own name as a likely existing patient", () => {
    const r = describeRepeatPattern([at("2024-09-20", "Yadav Homeo Clinic"), at("2024-10-05", "Yadav Homeo Clinic"), at("2025-03-05", "Neurologists")]);
    expect(r?.kind).toBe("BRAND");
  });

  it("flags many searches packed into two months as suspicious", () => {
    const r = describeRepeatPattern([
      at("2025-12-04", "Homeopathic Hospitals"), at("2025-12-05", "Homeopathic Doctors"), at("2025-12-22", "Homeopathic Doctors"),
      at("2025-12-24", "Homeopathic Clinics"), at("2026-01-06", "Homeopathic Clinics"),
    ]);
    expect(r?.kind).toBe("SUSPICIOUS");
  });

  it("flags four specialties within six months as suspicious", () => {
    const r = describeRepeatPattern([at("2026-01-01", "Neurologists"), at("2026-02-01", "Dermatologists"), at("2026-03-15", "Oncologists"), at("2026-05-01", "Nephrologists")]);
    expect(r?.kind).toBe("SUSPICIOUS");
  });

  it("treats four specialties spread over years as a family or agent", () => {
    const r = describeRepeatPattern([at("2025-01-05", "Paediatricians"), at("2025-07-21", "Dermatologists"), at("2025-12-28", "Nephrologists"), at("2026-08-24", "Oncologists")]);
    expect(r?.kind).toBe("MANY_PROBLEMS");
  });

  it("reads the same specialty months later as not relieved", () => {
    const r = describeRepeatPattern([at("2025-06-09", "Neurologists"), at("2026-04-02", "Neurologists")]);
    expect(r?.kind).toBe("SAME_AGAIN");
    expect(r?.text).toContain("10 mahine baad");
  });

  it("reads the same specialty within two days as urgent", () => {
    expect(describeRepeatPattern([at("2026-10-01", "Asthma Doctors"), at("2026-10-02", "Pulmonologists Doctors")])?.kind).toBe("URGENT_SAME");
  });

  it("reads a switch from a specialty to homeopathy as the same problem, now wanting homeopathy", () => {
    const r = describeRepeatPattern([at("2026-07-11", "Dermatologists"), at("2026-08-10", "Dermatologists"), at("2026-10-18", "Homeopathic Doctors")]);
    expect(r?.kind).toBe("WANTS_HOMEOPATHY");
    expect(r?.text).toContain("Skin Diseases");
  });

  it("looks past a homeopathy search when the specialty comes back", () => {
    expect(describeRepeatPattern([at("2025-01-01", "Neurologists"), at("2025-03-01", "Homeopathic Doctors"), at("2025-09-01", "Neurologists")])?.kind).toBe("SAME_AGAIN");
  });

  it("separates a new problem after a long gap from one soon after", () => {
    expect(describeRepeatPattern([at("2025-01-01", "Paediatricians"), at("2025-09-01", "Dermatologists")])?.kind).toBe("NEW_PROBLEM_LATER");
    expect(describeRepeatPattern([at("2025-01-01", "Paediatricians"), at("2025-02-01", "Dermatologists")])?.kind).toBe("NEW_PROBLEM_SOON");
  });
});
