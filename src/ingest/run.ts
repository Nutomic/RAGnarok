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
  },
  {
    file: "data/eurlex/ai-act.html",
    title: "KI-Verordnung (Verordnung (EU) 2024/1689)",
    visibility: "public" as const,
    sourceUrl: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj",
  },
];

async function main() {
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
      console.log(`skip ${reg.title} (already ingested)`);
      continue;
    }

    const [doc] = await db
      .insert(documents)
      .values({
        title: reg.title,
        sourceUrl: reg.sourceUrl,
        contentHash,
        visibility: reg.visibility,
      })
      .returning({ id: documents.id });

    let position = 0;
    for (const c of chunked) {
      for (const chunk of c.chunks) {
        const embedding = await embedder.embed(chunk.content);
        await db.insert(chunks).values({
          documentId: doc.id,
          content: chunk.content,
          position: position++,
          embedding,
          tsvector: sql`to_tsvector('german', ${chunk.content})`,
        });
      }
    }
    console.log(`ingested ${reg.title}: ${chunked.length} sections, ${position} chunks`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
