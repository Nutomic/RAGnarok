// Rerank benchmark: rerank-on vs off over the golden set. Run locally, not
// part of the CI gate:
//   RERANK_CANDIDATES=20 DATABASE_URL=... npx tsx src/eval/rerank-benchmark.ts
// Measured 2026-10-05, cross-encoder/mmarco-mMiniLMv2-L12-H384-v1, q8 ONNX:
// 20 candidates: hit@5 0.739 -> 0.739, MRR@5 0.471 -> 0.600, 4.7 s/query (fp32)
// 10 candidates: hit@5 0.652 -> 0.696, MRR@5 0.453 -> 0.570, 1.7 s/query (q8)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { retrieveHybrid } from "../db/retrieve";
import { TransformersEmbedder } from "../ingest/embed";
import { TransformersReranker } from "../rerank";

const K = 5;
const CANDIDATES = Number(process.env.RERANK_CANDIDATES ?? 20);

interface GoldenQuestion {
  q: string;
  type: "factual" | "cross-article" | "abstention";
  section?: { type: "article" | "recital"; number: number };
  sections?: { type: "article" | "recital"; number: number }[];
}

function expected(question: GoldenQuestion) {
  return question.section ? [question.section] : (question.sections ?? []);
}

function hitRanks(
  ranked: { sectionType: string; sectionNumber: number }[],
  expectedSections: { type: string; number: number }[],
): number[] {
  const ranks: number[] = [];
  ranked.forEach((chunk, i) => {
    if (
      expectedSections.some((s) => s.type === chunk.sectionType && s.number === chunk.sectionNumber)
    ) {
      ranks.push(i + 1);
    }
  });
  return ranks;
}

export async function rerankBenchmark() {
  const golden: GoldenQuestion[] = JSON.parse(
    readFileSync(join(process.cwd(), "data/eval/golden.json"), "utf8"),
  );
  const answerable = golden.filter((q) => q.type !== "abstention");
  const embedder = new TransformersEmbedder();
  const reranker = new TransformersReranker();

  let baseHits = 0;
  let rerankHits = 0;
  let baseRR = 0;
  let rerankRR = 0;
  let rerankMs = 0;
  let worst = 0;
  for (const q of answerable) {
    const sections = expected(q);
    const { embedding } = await embedder.embed(q.q, "query");
    const pool = await retrieveHybrid(q.q, embedding, {
      k: CANDIDATES,
      candidates: CANDIDATES,
      profileVisibility: "compliance",
    });

    const start = Date.now();
    const reranked = await reranker.rerank(q.q, pool);
    rerankMs += Date.now() - start;
    worst = Math.max(worst, Date.now() - start);

    const base = hitRanks(pool.slice(0, K), sections);
    const rer = hitRanks(reranked, sections);
    baseHits += base.length > 0 ? 1 : 0;
    rerankHits += rer.length > 0 ? 1 : 0;
    baseRR += base.length > 0 ? 1 / base[0] : 0;
    rerankRR += rer.length > 0 ? 1 / rer[0] : 0;
    console.log(
      `${base[0] === rer[0] ? " " : "X"} ${q.q.slice(0, 50)}  base=[${base}] rerank=[${rer}]`,
    );
  }
  const n = answerable.length;
  console.log(`\nn=${n} candidates=${CANDIDATES} k=${K}`);
  console.log(`hit@5 off=${(baseHits / n).toFixed(3)} on=${(rerankHits / n).toFixed(3)}`);
  console.log(`MRR@5 off=${(baseRR / n).toFixed(3)} on=${(rerankRR / n).toFixed(3)}`);
  console.log(`rerank latency avg=${(rerankMs / n).toFixed(0)}ms worst=${worst}ms`);
}

if (process.argv[1]?.endsWith("rerank-benchmark.ts")) {
  rerankBenchmark().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
