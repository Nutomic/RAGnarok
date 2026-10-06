import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type RetrieveStrategy, retrieveByStrategy } from "../db/retrieve";
import { TransformersEmbedder } from "../ingest/embed";

interface ExpectedSection {
  type: "article" | "recital";
  number: number;
}

export interface GoldenQuestion {
  q: string;
  type: "factual" | "cross-article" | "abstention";
  // CELEX id; absent for abstention questions
  doc?: string;
  section?: ExpectedSection;
  sections?: ExpectedSection[];
  // abstention questions: content word that must not appear in any retrieved
  // chunk; a hit means the corpus pulled in off-topic material
  kind?: string;
}

interface Metrics {
  hit_at_5: number;
  mrr_at_5: number;
  context_recall: number;
}

// Ground truth is the set of article/recital sections; a chunk matches when its
// section metadata agrees, regardless of which paragraph chunk of the section
// was retrieved.
function expected(question: GoldenQuestion): ExpectedSection[] {
  if (question.section) return [question.section];
  return question.sections ?? [];
}

// Unique expected sections that appear at least once in the retrieved list;
// recall is over sections, not chunks (a section may span several chunks).
function sectionsMatched(
  retrieved: { sectionType: string; sectionNumber: number }[],
  expectedSections: ExpectedSection[],
): number {
  const hit = new Set(
    retrieved
      .filter((c) =>
        expectedSections.some((s) => s.type === c.sectionType && s.number === c.sectionNumber),
      )
      .map((c) => `${c.sectionType}#${c.sectionNumber}`),
  );
  return hit.size;
}

function matched(
  retrieved: { sectionType: string; sectionNumber: number }[],
  expectedSections: ExpectedSection[],
): number[] {
  const ranks: number[] = [];
  retrieved.forEach((chunk, i) => {
    const hit = expectedSections.some(
      (s) => s.type === chunk.sectionType && s.number === chunk.sectionNumber,
    );
    if (hit) ranks.push(i + 1);
  });
  return ranks;
}

// CI gate thresholds for the hybrid strategy. Calibrated to the mixed golden
// set (alternating original + paraphrased questions, e5-base q8): hit 0.826,
// mrr 0.599, recall 0.739, minus a regression margin. Recall counts unique
// expected sections, not chunk hits. Raise deliberately when retrieval
// improves.
const THRESHOLDS: Metrics = {
  // share of questions with at least one expected section in the top 5
  hit_at_5: 0.75,
  // mean of 1/(first rank of an expected section); 1.0 = always rank 1
  mrr_at_5: 0.54,
  // share of all expected sections retrieved (cross-article questions only)
  context_recall: 0.7,
};

// Retrieval is compared across four strategies (see README benchmark table);
// all share the same corpus, visibility filter and k.
const STRATEGIES: RetrieveStrategy[] = ["fts", "vector", "hybrid", "rerank"];

interface StrategyResult extends Metrics {
  // SQL round-trip time; embedding cost is shared between strategies and
  // reported once at the top level.
  mean_ms: number;
  p95_ms: number;
}

export async function evaluateRetrieval() {
  const golden: GoldenQuestion[] = JSON.parse(
    readFileSync(join(process.cwd(), "data/golden.json"), "utf8"),
  );

  const embedder = new TransformersEmbedder();
  const answerable = golden.filter((q) => q.type !== "abstention");
  const abstentions = golden.filter((q) => q.type === "abstention");

  // Model load + first inference dominate; report separately from steady-state.
  const t0 = performance.now();
  await embedder.embed(answerable[0].q, "query");
  console.log(`embeddings: warmup ${Math.round(performance.now() - t0)}ms`);

  const embedMs: number[] = [];
  // one score list + one SQL latency list per strategy
  const ranksByStrategy = new Map<RetrieveStrategy, number[][]>(STRATEGIES.map((s) => [s, []]));
  const sectionsByStrategy = new Map<RetrieveStrategy, number[]>(STRATEGIES.map((s) => [s, []]));
  const msByStrategy = new Map<RetrieveStrategy, number[]>(STRATEGIES.map((s) => [s, []]));
  const failures: string[] = [];

  // Gather ranks of expected sections per question
  for (const q of answerable) {
    const start = performance.now();
    const { embedding } = await embedder.embed(q.q, "query");
    embedMs.push(performance.now() - start);
    for (const s of STRATEGIES) {
      const t = performance.now();
      const retrieved = await retrieveByStrategy(s, q.q, embedding, {
        k: 5,
        // Ground truth spans both regulations; evaluate against the full corpus.
        visibility: "compliance",
      });
      msByStrategy.get(s)?.push(performance.now() - t);
      const ranks = matched(retrieved, expected(q));
      ranksByStrategy.get(s)?.push(ranks);
      sectionsByStrategy.get(s)?.push(sectionsMatched(retrieved, expected(q)));
      if (s === "hybrid" && ranks.length === 0) {
        failures.push(q.q);
      }
    }
  }

  const meanOf = (ms: number[]) => ms.reduce((a, b) => a + b, 0) / ms.length;
  const p95Of = (ms: number[]) => ms.sort((a, b) => a - b)[Math.floor(ms.length * 0.95)];

  const strategies: Record<RetrieveStrategy, StrategyResult> = {} as Record<
    RetrieveStrategy,
    StrategyResult
  >;
  for (const s of STRATEGIES) {
    const ranks = ranksByStrategy.get(s) ?? [];
    let hits = 0;
    let reciprocalRankSum = 0;
    let recallSum = 0;
    ranks.forEach((r, i) => {
      if (r.length > 0) hits += 1;
      reciprocalRankSum += r.length > 0 ? 1 / r[0] : 0;
      const expectedSections = expected(answerable[i]);
      recallSum +=
        Math.min(sectionsByStrategy.get(s)?.[i] ?? 0, expectedSections.length) /
        expectedSections.length;
    });
    strategies[s] = {
      hit_at_5: hits / answerable.length,
      mrr_at_5: reciprocalRankSum / answerable.length,
      context_recall: recallSum / answerable.length,
      mean_ms: meanOf(msByStrategy.get(s) ?? []),
      p95_ms: p95Of(msByStrategy.get(s) ?? []),
    };
  }

  const metrics = strategies.hybrid;
  console.log(`n=${answerable.length} answerable, ${abstentions.length} abstention`);
  const embedMean = meanOf(embedMs);
  console.log(
    `embeddings: mean ${embedMean.toFixed(1)}ms, p95 ${p95Of(embedMs).toFixed(1)}ms, n=${embedMs.length}`,
  );
  for (const s of STRATEGIES) {
    const r = strategies[s];
    console.log(
      `${s}: hit ${r.hit_at_5.toFixed(3)}, mrr ${r.mrr_at_5.toFixed(3)}, recall ${r.context_recall.toFixed(3)}, query mean ${r.mean_ms.toFixed(1)}ms p95 ${r.p95_ms.toFixed(1)}ms`,
    );
  }

  // Gate runs on hybrid only: it is the shipping strategy.
  let failed = false;
  for (const [name, threshold] of Object.entries(THRESHOLDS)) {
    const value = metrics[name as keyof Metrics];
    const ok = value >= threshold;
    if (!ok) failed = true;
    console.log(`${name}: ${value.toFixed(3)} (threshold ${threshold}) ${ok ? "ok" : "FAIL"}`);
  }
  // Cross-article questions often miss a section while still being answerable,
  // the miss list shows which questions regressed when the metrics gate trips.
  if (failures.length > 0) {
    console.log("no expected section in top-5:");
    for (const f of failures) console.log(`  ${f}`);
  }

  // Abstention questions: the corpus must not surface their subject matter.
  // Generation-side refusal is measured in tier 2.
  for (const q of abstentions) {
    const { kind } = q;
    if (!kind) continue;
    const { embedding } = await embedder.embed(q.q, "query");
    const retrieved = await retrieveByStrategy("hybrid", q.q, embedding, {
      k: 5,
      visibility: "compliance",
    });
    // chunks whose text mentions the question's subject: retrieval pulled
    // off-topic material instead of the corpus staying silent
    const polluted = retrieved.filter((c) => c.content.toLowerCase().includes(kind.toLowerCase()));
    if (polluted.length > 0) {
      failed = true;
      console.log(
        `abstention FAIL: "${q.q}" retrieved ${polluted.length} chunks containing "${kind}"`,
      );
    }
  }
  if (failed) process.exit(1);

  // Separate artifact from generation.json (which holds the judge metrics):
  // consumed by eval-report for the README table + chart.
  mkdirSync(join(process.cwd(), "data/eval"), { recursive: true });
  writeFileSync(
    join(process.cwd(), "data/eval/retrieval.json"),
    `${JSON.stringify({ timestamp: new Date().toISOString(), embeddings_mean_ms: embedMean, strategies }, null, 2)}\n`,
  );
}
