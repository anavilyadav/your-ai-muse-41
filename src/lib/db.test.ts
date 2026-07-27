import { describe, it, expect } from "vitest";
import {
  normalizePaymentMode,
  normalizeMobile,
  sanitizeOrFilterTerm,
  sanitizeIlikeTerm,
  thirtyDaysAgo,
  looksLikeHeic,
  generateSlots,
} from "./db";

describe("normalizePaymentMode", () => {
  it("keeps known modes as-is", () => {
    expect(normalizePaymentMode("CASH")).toBe("CASH");
    expect(normalizePaymentMode("UPI")).toBe("UPI");
    expect(normalizePaymentMode("CARD")).toBe("CARD");
  });
  it("is case-insensitive on known modes", () => {
    expect(normalizePaymentMode("cash")).toBe("CASH");
    expect(normalizePaymentMode("upi")).toBe("UPI");
  });
  it("buckets unrecognized modes as OTHER", () => {
    expect(normalizePaymentMode("NEFT")).toBe("OTHER");
    expect(normalizePaymentMode("QR")).toBe("OTHER");
    expect(normalizePaymentMode("cheque")).toBe("OTHER");
  });
  it("defaults empty/null/undefined to CASH", () => {
    expect(normalizePaymentMode("")).toBe("CASH");
    expect(normalizePaymentMode(null)).toBe("CASH");
    expect(normalizePaymentMode(undefined)).toBe("CASH");
  });
});

describe("normalizeMobile", () => {
  it("strips non-digit characters", () => {
    expect(normalizeMobile("+91 98765-43210")).toBe("9876543210");
  });
  it("keeps the last 10 digits if longer (drops country code)", () => {
    expect(normalizeMobile("919876543210")).toBe("9876543210");
  });
  it("returns whatever digits exist if fewer than 10 (caller validates length)", () => {
    expect(normalizeMobile("12345")).toBe("12345");
  });
  it("handles null/undefined safely", () => {
    expect(normalizeMobile(null)).toBe("");
    expect(normalizeMobile(undefined)).toBe("");
  });
});

describe("sanitizeOrFilterTerm (patient/lead search)", () => {
  it("strips comma and parens that break PostgREST .or() syntax", () => {
    expect(sanitizeOrFilterTerm("Sharma, Suresh")).toBe("Sharma Suresh");
    expect(sanitizeOrFilterTerm("Patel (Jaipur)")).toBe("Patel Jaipur");
  });
  it("strips ILIKE wildcards (% and _) so they're not treated as pattern matches", () => {
    expect(sanitizeOrFilterTerm("50% off")).toBe("50 off");
    expect(sanitizeOrFilterTerm("type_A")).toBe("type A");
  });
  it("collapses repeated whitespace left behind by stripping", () => {
    expect(sanitizeOrFilterTerm("A,,,B")).toBe("A B");
  });
  it("leaves normal names untouched", () => {
    expect(sanitizeOrFilterTerm("Anavil Yadav")).toBe("Anavil Yadav");
  });
});

describe("sanitizeIlikeTerm (inventory search)", () => {
  it("strips wildcards but keeps comma/parens (single .ilike(), not .or())", () => {
    expect(sanitizeIlikeTerm("Arnica 30_C")).toBe("Arnica 30 C");
    expect(sanitizeIlikeTerm("50%")).toBe("50");
  });
});

describe("thirtyDaysAgo", () => {
  it("returns a YYYY-MM-DD formatted date string", () => {
    expect(thirtyDaysAgo()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("is actually ~30 days before today", () => {
    const result = new Date(thirtyDaysAgo());
    const expected = new Date();
    expected.setDate(expected.getDate() - 30);
    // Compare just the date portion, allowing for test-runtime clock skew.
    expect(result.toISOString().slice(0, 10)).toBe(expected.toISOString().slice(0, 10));
  });
});

describe("looksLikeHeic", () => {
  const makeFile = (name: string, type: string) => new File(["x"], name, { type });

  it("detects by MIME type", () => {
    expect(looksLikeHeic(makeFile("photo.jpg", "image/heic"))).toBe(true);
    expect(looksLikeHeic(makeFile("photo.jpg", "image/heif"))).toBe(true);
  });
  it("detects by file extension when MIME type is generic/missing", () => {
    expect(looksLikeHeic(makeFile("IMG_1234.HEIC", ""))).toBe(true);
    expect(looksLikeHeic(makeFile("photo.heif", "application/octet-stream"))).toBe(true);
  });
  it("does not flag normal images", () => {
    expect(looksLikeHeic(makeFile("photo.jpg", "image/jpeg"))).toBe(false);
    expect(looksLikeHeic(makeFile("photo.png", "image/png"))).toBe(false);
  });
});

describe("generateSlots", () => {
  it("generates evenly spaced slots within the given window", () => {
    expect(generateSlots("09:00", "10:00", 15)).toEqual(["09:00", "09:15", "09:30", "09:45"]);
  });
  it("returns an empty list when end is not after start (bad config)", () => {
    expect(generateSlots("10:00", "09:00", 15)).toEqual([]);
  });
  it("never loops forever on a degenerate config (500-iteration guard)", () => {
    // minutes=0 would infinite-loop without the guard — this must return
    // quickly with a bounded result instead of hanging the test (and, in
    // the real app, the Owner's Slot Settings screen).
    const result = generateSlots("00:00", "23:59", 0);
    expect(result.length).toBeLessThanOrEqual(500);
  });
});
