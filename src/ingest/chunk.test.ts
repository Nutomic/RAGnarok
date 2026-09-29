import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chunkSections } from "./chunk";
import { parseEurlex } from "./parse";

const dsgvo = readFileSync(join(process.cwd(), "data/eurlex/dsgvo.html"), "utf8");

describe("chunkSections", () => {
  it("produces at least one chunk per section", () => {
    const sections = parseEurlex(dsgvo);
    const chunked = chunkSections(sections);
    const total = chunked.reduce((n, c) => n + c.chunks.length, 0);
    expect(total).toBeGreaterThanOrEqual(sections.length);
  });

  it("keeps chunks within their section (no cross-article splits)", () => {
    const chunked = chunkSections(parseEurlex(dsgvo));
    for (const c of chunked) {
      for (const chunk of c.chunks) {
        expect(chunk.content.startsWith(c.section.title)).toBe(true);
      }
    }
  });

  it("splits long sections into multiple chunks", () => {
    const sections = parseEurlex(dsgvo);
    const chunked = chunkSections(sections, 500);
    // Artikel 4 (definitions) is the longest section; it must split.
    const art4 = chunked.find((c) => c.section.type === "article" && c.section.number === 4)!;
    expect(art4.chunks.length).toBeGreaterThan(1);
  });

  it("loses no text when splitting a long section", () => {
    const sections = parseEurlex(dsgvo);
    const art4 = sections.find((s) => s.type === "article" && s.number === 4)!;
    const [chunked] = chunkSections([art4], 500);
    const joined = chunked.chunks
      .map((c) => c.content.slice(chunked.section.title.length + 2))
      .join(" ");
    expect(joined).toBe(art4.text);
  });
});
