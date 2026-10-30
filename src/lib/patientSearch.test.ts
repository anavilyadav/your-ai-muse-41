import { describe, expect, it } from "vitest";
import { canonicalCard, cardFilterGroup, cardMatchesTerm, matchedOldCard, parseCardTerm, sortPatients } from "./patientSearch";

describe("parseCardTerm", () => {
  it("reads a card typed the usual ways", () => {
    for (const t of ["A-57-39", "A 57-39", "a57 39", "A - 57 - 39"]) {
      expect(parseCardTerm(t)).toEqual({ series: "A", register: "57", numbers: ["39", "39A", "39B", "39C"] });
    }
    expect(parseCardTerm("B-5-79")).toEqual({ series: "B", register: "05", numbers: ["79", "79A", "79B", "79C"] });
    expect(parseCardTerm("B-26-50a")).toEqual({ series: "B", register: "26", numbers: ["50A"] });
    expect(parseCardTerm("57-39")).toEqual({ register: "57", numbers: ["39", "39A", "39B", "39C"] });
    expect(parseCardTerm("B-81")).toEqual({ series: "B", register: "81" });
    expect(parseCardTerm("1T-24")).toEqual({ series: "1T", numbers: ["24", "24A", "24B", "24C"] });
    expect(parseCardTerm("Priyank")).toBeNull();
    expect(parseCardTerm("9928176555")).toBeNull();
  });

  it("builds exact filters", () => {
    expect(cardFilterGroup("B 81-14")).toBe(
      "and(card_series.eq.B,card_register.eq.81,card_number.in.(14,14A,14B,14C)),old_cards.ov.{B-81-14,B-81-14A,B-81-14B,B-81-14C}",
    );
    expect(cardFilterGroup("B-81")).toBe("and(card_series.eq.B,card_register.eq.81)");
    expect(cardFilterGroup("39")).toBe("or(card_register.eq.39,card_number.in.(39,39A,39B,39C))");
    expect(cardFilterGroup("sulekha")).toBe("");
  });
});

describe("sortPatients", () => {
  const rows = [
    { name: "Priyanka", card_series: "B", card_register: "57", card_number: "39", last_visit_date: "2026-01-01", lifetime_visits: 2 },
    { name: "PRIYANK GANG", card_series: "A", card_register: "57", card_number: "39", last_visit_date: null, lifetime_visits: 0 },
    { name: "Amit Priyank", card_series: "A", card_register: "05", card_number: "02", last_visit_date: "2026-05-01", lifetime_visits: 9 },
  ];
  it("finds a patient by an earlier card", () => {
    const priyank = { name: "PRIYANK GANG", card_series: "B", card_register: "05", card_number: "79", old_cards: ["A-57-39"] };
    expect(matchedOldCard(priyank, "A 57-39")).toBe("A-57-39");
    expect(matchedOldCard(priyank, "B-05-79")).toBeNull();
    expect(sortPatients([...rows, priyank], "best", "a-57-39").map((r) => r.name).slice(0, 2)).toEqual(["PRIYANK GANG", "PRIYANK GANG"]);
    expect(canonicalCard("b 5 79")).toBe("B-05-79");
    expect(canonicalCard("1t 24")).toBe("1T-24");
    expect(canonicalCard("priyank")).toBeNull();
  });

  it("puts the exact card first for best match", () => {
    expect(cardMatchesTerm(rows[1], "A 57-39")).toBe(true);
    expect(sortPatients(rows, "best", "A 57-39")[0].name).toBe("PRIYANK GANG");
    expect(sortPatients(rows, "best", "priyank").map((r) => r.name)).toEqual(["PRIYANK GANG", "Amit Priyank", "Priyanka"]);
  });
  it("sorts by name, card, last visit and visits", () => {
    expect(sortPatients(rows, "name").map((r) => r.name)).toEqual(["Amit Priyank", "PRIYANK GANG", "Priyanka"]);
    expect(sortPatients(rows, "card").map((r) => r.name)).toEqual(["Amit Priyank", "PRIYANK GANG", "Priyanka"]);
    expect(sortPatients(rows, "recent").map((r) => r.name)).toEqual(["Amit Priyank", "Priyanka", "PRIYANK GANG"]);
    expect(sortPatients(rows, "visits")[0].name).toBe("Amit Priyank");
  });
});
