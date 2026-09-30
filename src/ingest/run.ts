import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { chunks, documents } from "../db/schema";
import { chunkSections } from "./chunk";
import { TransformersEmbedder } from "./embed";
import { parseEurlex } from "./parse";

const REGULATIONS = [
  {
    file: "data/eurlex/dsgvo.html",
    title: "DS-GVO (Verordnung (EU) 2016/679)",
    visibility: "compliance" as const,
    sourceUrl: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
    celex: "32016R0679",
  },
  {
    file: "data/eurlex/ai-act.html",
    title: "KI-Verordnung (Verordnung (EU) 2024/1689)",
    visibility: "public" as const,
    sourceUrl: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj",
    celex: "32024R1689",
  },
];

export async function ingest() {
  const embedder = new TransformersEmbedder();

  for (const reg of REGULATIONS) {
    const html = readFileSync(reg.file, "utf8");
    const sections = parseEurlex(html);
    const chunked = chunkSections(sections);
    const fullText = sections.map((s) => s.text).join("\n");
    const contentHash = createHash("sha256").update(fullText).digest("hex");

    const existing = await db.query.documents.findFirst({
      where: (d, { eq }) => eq(d.contentHash, contentHash),
    });
    if (existing) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(chunks)
        .where(sql`${chunks.documentId} = ${existing.id}`);
      const expected = chunked.reduce((n, c) => n + c.chunks.length, 0);
      if (count === expected) {
        console.log(`skip ${reg.title} (already ingested, ${count} chunks)`);
        continue;
      }
      // Partial ingest (e.g. interrupted run): document row committed, chunks
      // missing. Chunked content differs from what's stored, so drop and redo.
      console.log(`redo ${reg.title} (found ${count}/${expected} chunks)`);
      await db.delete(documents).where(sql`${documents.id} = ${existing.id}`);
    }

    const [doc] = await db
      .insert(documents)
      .values({
        title: reg.title,
        sourceUrl: reg.sourceUrl,
        celex: reg.celex,
        contentHash,
        visibility: reg.visibility,
      })
      .returning({ id: documents.id });

    let position = 0;
    let tokens = 0;
    for (const c of chunked) {
      for (const chunk of c.chunks) {
        const { embedding, tokens: chunkTokens } = await embedder.embed(chunk.content);
        tokens += chunkTokens;
        await db.insert(chunks).values({
          documentId: doc.id,
          content: chunk.content,
          position: position++,
          sectionType: c.section.type,
          sectionNumber: c.section.number,
          sectionTitle: c.section.title,
          anchor: c.section.anchor,
          embedding,
          tsvector: sql`to_tsvector('german', ${chunk.content})`,
        });
      }
    }
    console.log(
      `ingested ${reg.title}: ${chunked.length} sections, ${position} chunks, ${tokens} embedding tokens (local, 0 EUR)`,
    );
  }
}
