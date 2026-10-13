import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEurlex } from "./parse";

// Corpus lives at the repo root; tests run with app/ as cwd, the container with /app.
const readCorpus = (file: string) => {
  const p = join(process.cwd(), "data/eurlex", file);
  return readFileSync(existsSync(p) ? p : join(process.cwd(), "..", "data/eurlex", file), "utf8");
};

const dsgvo = readCorpus("dsgvo.html");
const aiAct = readCorpus("ai-act.html");

describe("parseEurlex", () => {
  it("parses the DS-GVO file into 173 recitals and 99 articles", () => {
    const sections = parseEurlex(dsgvo);
    const recitals = sections.filter((s) => s.type === "recital");
    const articles = sections.filter((s) => s.type === "article");
    expect(recitals).toHaveLength(173);
    expect(articles).toHaveLength(99);
  });

  it("parses the AI Act file into 180 recitals and 113 articles", () => {
    const sections = parseEurlex(aiAct);
    const recitals = sections.filter((s) => s.type === "recital");
    const articles = sections.filter((s) => s.type === "article");
    expect(recitals).toHaveLength(180);
    expect(articles).toHaveLength(113);
  });

  it("keeps recitals and articles in document order", () => {
    const sections = parseEurlex(dsgvo);
    expect(sections[0]).toMatchObject({ type: "recital", number: 1 });
    expect(sections.at(-1)).toMatchObject({ type: "article", number: 99 });
    // first article comes after all recitals
    const firstArticle = sections.findIndex((s) => s.type === "article");
    expect(firstArticle).toBe(173);
  });

  it("captures non-empty text for every section", () => {
    for (const s of parseEurlex(dsgvo)) {
      expect(s.text.length).toBeGreaterThan(0);
    }
  });

  it("numbers recitals and articles sequentially", () => {
    const sections = parseEurlex(dsgvo);
    const recitals = sections.filter((s) => s.type === "recital");
    const articles = sections.filter((s) => s.type === "article");
    expect(recitals.map((r) => r.number)).toEqual(Array.from({ length: 173 }, (_, i) => i + 1));
    expect(articles.map((a) => a.number)).toEqual(Array.from({ length: 99 }, (_, i) => i + 1));
  });

  it("captures the EUR-Lex anchor for every section", () => {
    const sections = parseEurlex(dsgvo);
    expect(sections.find((s) => s.type === "article" && s.number === 32)).toMatchObject({
      anchor: "art_32",
    });
    expect(sections.find((s) => s.type === "recital" && s.number === 5)).toMatchObject({
      anchor: "rct_5",
    });
    for (const s of sections) {
      expect(s.anchor).toMatch(/^(art|rct)_\d+$/);
    }
  });
});
