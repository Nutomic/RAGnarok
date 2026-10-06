// Benchmark: embed the golden questions with candidate models, report
// warmup (model load + first inference), mean and p95 of steady-state
// latency per model. Run outside docker: npx tsx scripts/embed-bench.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "@huggingface/transformers";

const MODELS = [
  "Xenova/multilingual-e5-small",
  "Xenova/multilingual-e5-base",
  "Xenova/multilingual-e5-large",
] as const;

type Extractor = (
  text: string,
  options: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array }>;

async function main() {
  const golden: { q: string }[] = JSON.parse(
    readFileSync(join(process.cwd(), "data/eval/golden.json"), "utf8"),
  );
  const questions = golden.filter((g) => g.type !== "abstention").map((g) => g.q);

  for (const model of MODELS) {
    for (const dtype of ["fp32", "q8"] as const) {
      try {
        const t0 = performance.now();
        const ex = (await pipeline("feature-extraction", model, { dtype })) as unknown as Extractor;
        await ex(`query: ${questions[0]}`, { pooling: "mean", normalize: true });
        const warmup = Math.round(performance.now() - t0);

        const ms: number[] = [];
        for (const q of questions) {
          const s = performance.now();
          await ex(`query: ${q}`, { pooling: "mean", normalize: true });
          ms.push(performance.now() - s);
        }
        const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
        const p95 = [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)];
        const dim = (await ex(questions[0], { pooling: "mean", normalize: true })).data.length;
        console.log(
          `${model} (${dtype}): warmup ${warmup}ms, mean ${mean.toFixed(1)}ms, p95 ${p95.toFixed(1)}ms, dim ${dim}, n=${ms.length}`,
        );
      } catch (err) {
        console.log(`${model} (${dtype}): FAILED — ${(err as Error).message.slice(0, 120)}`);
      }
    }
  }
}

main();
