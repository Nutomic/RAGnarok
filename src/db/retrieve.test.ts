import { describe, expect, it } from "vitest";
import { ftsTerms } from "./retrieve";

describe("ftsTerms", () => {
  it("joins remaining words with | for OR semantics", () => {
    // Casing is preserved: stemming (incl. lowercasing) is Postgres's job.
    expect(ftsTerms("Datenschutz Lance Strikes")).toBe("Datenschutz | Lance | Strikes");
  });

  it("keeps words of length > 2 and drops shorter ones", () => {
    // "zu"/"im" (2 letters) would match half the chunks and are dropped.
    expect(ftsTerms("Wie zu lange im")).toBe("Wie | lange");
    expect(ftsTerms("zu im")).toBe("");
  });

  it("strips to_tsquery syntax characters so the query cannot throw", () => {
    // These characters have tsquery meaning.
    expect(ftsTerms("Datenschutz (DSGVO) (& | ! * : KI-Verordnung!")).toBe(
      "Datenschutz | DSGVO | Verordnung",
    );
    expect(ftsTerms("Hochrisiko:KI*")).toBe("Hochrisiko");
  });

  it("keeps numbers and unicode letters", () => {
    expect(ftsTerms("Verordnung 2024/1689")).toBe("Verordnung | 2024 | 1689");
  });

  it("returns empty string for empty or punctuation-only input (fts leg disabled)", () => {
    expect(ftsTerms("")).toBe("");
    expect(ftsTerms("?!&|*")).toBe("");
    expect(ftsTerms("   ")).toBe("");
  });
});
