import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { retrieveHybrid } from "../db/retrieve";
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

// CI gate thresholds, calibrated to the baseline run (hit 0.696, mrr 0.464,
// recall 0.870) minus a small regression margin. Raise deliberately when
// retrieval improves.
const THRESHOLDS: Metrics = {
  // share of questions with at least one expected section in the top 5
  hit_at_5: 0.65,
  // mean of 1/(first rank of an expected section); 1.0 = always rank 1
  mrr_at_5: 0.42,
  // share of all expected sections retrieved (cross-article questions only)
  context_recall: 0.82,
};

export async function evaluateRetrieval() {
  const golden: GoldenQuestion[] = JSON.parse(
    readFileSync(join(process.cwd(), "data/eval/golden.json"), "utf8"),
  );

  const embedder = new TransformersEmbedder();
  const answerable = golden.filter((q) => q.type !== "abstention");
  const abstentions = golden.filter((q) => q.type === "abstention");

  // Model load + first inference dominate; report separately from steady-state.
  const t0 = performance.now();
  await embedder.embed(answerable[0].q, "query");
  console.log(`embeddings: warmup ${Math.round(performance.now() - t0)}ms`);

  const embedMs: number[] = [];
  let hits = 0;
  let reciprocalRankSum = 0;
  let recallSum = 0;
  const failures: string[] = [];

  // Gather ranks of expected sections per question
  for (const q of answerable) {
    const start = performance.now();
    const { embedding } = await embedder.embed(q.q, "query");
    embedMs.push(performance.now() - start);
    const retrieved = await retrieveHybrid(q.q, embedding, {
      k: 5,
      // Ground truth spans both regulations; evaluate against the full corpus.
      profileVisibility: "compliance",
    });
    const ranks = matched(retrieved, expected(q));

    if (ranks.length > 0) hits += 1;
    reciprocalRankSum += ranks.length > 0 ? 1 / ranks[0] : 0;
    recallSum += ranks.length / expected(q).length;

    if (ranks.length === 0) failures.push(q.q);
  }

  const metrics: Metrics = {
    hit_at_5: hits / answerable.length,
    mrr_at_5: reciprocalRankSum / answerable.length,
    context_recall: recallSum / answerable.length,
  };

  console.log(`n=${answerable.length} answerable, ${abstentions.length} abstention`);
  const mean = embedMs.reduce((a, b) => a + b, 0) / embedMs.length;
  const p95 = embedMs.sort((a, b) => a - b)[Math.floor(embedMs.length * 0.95)];
  console.log(
    `embeddings: mean ${mean.toFixed(1)}ms, p95 ${p95.toFixed(1)}ms, n=${embedMs.length}`,
  );
  let failed = false;
  // Gate: each metric must clear its threshold
  for (const [name, value] of Object.entries(metrics)) {
    const threshold = THRESHOLDS[name as keyof Metrics];
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
    const retrieved = await retrieveHybrid(q.q, embedding, {
      k: 5,
      profileVisibility: "compliance",
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

  // Merge into the shared results file; tier 2 adds its own section.
  const path = join(process.cwd(), "data/eval/results.json");
  let results: Record<string, unknown> = {};
  try {
    results = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // first eval run has no results yet
  }
  results.timestamp = new Date().toISOString();
  results.retrieval = metrics;
  writeFileSync(path, `${JSON.stringify(results, null, 2)}\n`);
}
