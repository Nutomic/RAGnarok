import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateText } from "ai";
import { z } from "zod";
import { type RetrieveStrategy, retrieveByStrategy } from "../db/retrieve";
import { chatModel, chatModelName, isLocalProvider, judgeModel, systemPrompt } from "../generate";
import { TransformersEmbedder } from "../ingest/embed";
import type { GoldenQuestion } from "./evaluate-retrieval";

// Run async jobs with up to 4 concurrent tasks
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// Same threshold mechanic as tier 1, but with generous noise margins: LLM-judge
// scores fluctuate between runs, so failures only annotate, never fail CI.
const THRESHOLDS = {
  // share of answer claims supported by the retrieved chunks
  faithfulness: 0.8,
  // share of answers that address the question asked
  relevancy: 0.8,
  // share of abstention questions where the answer declines instead of inventing
  refusal_rate: 0.7,
};

const faithfulnessSchema = z.object({
  score: z.number().min(0).max(1),
  unsupportedClaims: z.array(z.string()),
});

const relevancySchema = z.object({
  score: z.number().min(0).max(1),
});

const refusalSchema = z.object({
  refused: z.boolean(),
});

// OpenAI-compatible endpoints do not reliably honor json_schema response
// formats, so the judge answers plain text and we parse the JSON ourselves.
// Schema violations retry the call.
async function judgeJSON<T>(prompt: string, schema: z.ZodType<T>, maxAttempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    const { text } = await generateText({ model: judgeModel(), prompt });
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = schema.safeParse(JSON.parse(match[0]));
        if (parsed.success) return parsed.data;
        lastError = parsed.error;
      } catch (err) {
        lastError = err;
      }
    } else {
      lastError = new Error("no JSON object in judge response");
    }
    console.log(`judge output invalid, retry ${i + 1}/${maxAttempts}`);
  }
  throw new Error(`judge did not produce a valid result after ${maxAttempts} attempts`, {
    cause: lastError,
  });
}

export async function judgeGeneration(strategy: RetrieveStrategy = "hybrid") {
  // Local inference is benchmarked against the Mistral hybrid numbers only, so
  // it runs a single strategy (see eval-report.ts which joins both files).
  if (isLocalProvider() && strategy !== "hybrid") {
    throw new Error(
      `local provider only benchmarks hybrid, mistral results cover the other strategies`,
    );
  }
  const golden = JSON.parse(
    readFileSync(join(process.cwd(), "data/golden.json"), "utf8"),
  ) as GoldenQuestion[];
  const model = chatModel();
  const embedder = new TransformersEmbedder();

  const answerable = golden.filter((q) => q.type !== "abstention");
  const abstentions = golden.filter((q) => q.type === "abstention");

  // Generate all answers first, sequentially: Mistral rate-limits aggressively,
  // the SDK retries handle the rest.
  const answers: {
    question: string;
    answer: string;
    chunks: string[];
  }[] = [];
  for (const [i, q] of answerable.entries()) {
    console.log(`[${i + 1}/${answerable.length}] generating: ${q.q}`);
    const { embedding } = await embedder.embed(q.q, "query");
    const retrieved = await retrieveByStrategy(strategy, q.q, embedding, {
      k: 5,
      visibility: "compliance",
    });
    const { text } = await generateText({
      model,
      instructions: systemPrompt(retrieved, "compliance"),
      prompt: q.q,
    });
    answers.push({ question: q.q, answer: text, chunks: retrieved.map((c) => c.content) });
  }

  // Judging is read-only w.r.t. rate limits on the generator side, so all
  // judge calls run with bounded concurrency.
  const judged = await mapConcurrent(answers, 4, async (a) => {
    console.log(`judging: ${a.question}`);
    const shared = `Frage: ${a.question}\n\nAntwort:\n${a.answer}`;
    const [faithfulness, relevancy] = await Promise.all([
      judgeJSON(
        `${shared}

Quelltexte:
${a.chunks.join("\n\n")}

Prüfe jede Aussage der Antwort gegen die Quelltexte. Aussagen, die die Quelltexte nicht stützen (auch: erfundene Artikelnummern), sind nicht belegt. Bewerte den Anteil der belegten Aussagen.
Antworte ausschließlich mit einem JSON-Objekt: {"score": <0 bis 1>, "unsupportedClaims": [<Aussagen ohne Beleg>]}`,
        faithfulnessSchema,
      ),
      judgeJSON(
        `${shared}

Bewerte, wie gut die Antwort die Frage beantwortet (0 = gar nicht, 1 = vollständig und direkt). Ignoriere Stil.
Antworte ausschließlich mit einem JSON-Objekt: {"score": <0 bis 1>}`,
        relevancySchema,
      ),
    ]);
    return {
      question: a.question,
      faithfulness: faithfulness.score,
      unsupportedClaims: faithfulness.unsupportedClaims,
      relevancy: relevancy.score,
    };
  });

  for (const j of judged) {
    console.log(
      `${j.question}\n  faithfulness=${j.faithfulness.toFixed(2)} relevancy=${j.relevancy.toFixed(2)}`,
    );
    if (j.unsupportedClaims.length > 0) {
      console.log(`  unsupported: ${j.unsupportedClaims.join(" | ")}`);
    }
  }

  // Abstention answers also generate sequentially; only the judge verdicts
  // below run in parallel.
  const abstentionAnswers: { question: string; answer: string }[] = [];
  for (const q of abstentions) {
    const { embedding } = await embedder.embed(q.q, "query");
    const retrieved = await retrieveByStrategy(strategy, q.q, embedding, {
      k: 5,
      visibility: "compliance",
    });
    console.log(`generating abstention: ${q.q}`);
    const { text } = await generateText({
      model,
      instructions: systemPrompt(retrieved, "compliance"),
      prompt: q.q,
    });
    abstentionAnswers.push({ question: q.q, answer: text });
  }

  const refusalJudged = await mapConcurrent(abstentionAnswers, 4, async (a) => {
    const verdict = await judgeJSON(
      `Frage: ${a.question}

Antwort:
${a.answer}

Beantwortet die Antwort die Frage sachlich, oder lehnt sie ab / verweist darauf, dass der Kontext die Frage nicht beantwortet? Jede Erfindung oder Auskunft zu einer Frage außerhalb des Korpus zählt als nicht abgelehnt.
Antworte ausschließlich mit einem JSON-Objekt: {"refused": <true oder false>}`,
      refusalSchema,
    );
    return { question: a.question, refused: verdict.refused };
  });

  for (const r of refusalJudged) {
    console.log(`${r.question}\n  refused=${r.refused}`);
  }

  const metrics = {
    faithfulness: judged.length
      ? judged.reduce((s, j) => s + j.faithfulness, 0) / judged.length
      : 0,
    relevancy: judged.length ? judged.reduce((s, j) => s + j.relevancy, 0) / judged.length : 0,
    refusal_rate: refusalJudged.length
      ? refusalJudged.filter((r) => r.refused).length / refusalJudged.length
      : 0,
  };

  console.log(`n=${judged.length} answerable, ${refusalJudged.length} abstention`);
  for (const [name, value] of Object.entries(metrics)) {
    const threshold = THRESHOLDS[name as keyof typeof THRESHOLDS];
    const ok = value >= threshold;
    console.log(
      `${name}: ${value.toFixed(3)} (threshold ${threshold}) ${ok ? "ok" : "LOW (annotation only)"}`,
    );
  }

  // CI passes GITHUB_SHA; local docker runs have no .git and stay "unknown".
  let sha = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : "unknown";
  if (sha === "unknown") {
    try {
      sha = execSync("git rev-parse --short HEAD", {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      // eval can run outside a git checkout (docker)
    }
  }

  // One results file per generation provider, so mistral and local numbers can
  // be compared side-by-side (eval-report.ts joins them).
  const resultsFile = isLocalProvider() ? "local-generation.json" : "mistral-generation.json";
  const path = join(process.cwd(), "data/eval", resultsFile);
  let results: Record<string, unknown> = {};
  try {
    results = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // first eval run has no results yet
  }
  results.timestamp = new Date().toISOString();
  results.sha = sha;
  results.model = chatModelName();
  results.judge = process.env.JUDGE_MODEL ?? "unknown";
  results.generation = {
    ...((results.generation as object | undefined) ?? {}),
    [strategy]: metrics,
  };
  results.questions = { ...((results.questions as object | undefined) ?? {}), [strategy]: judged };
  results.refusals = {
    ...((results.refusals as object | undefined) ?? {}),
    [strategy]: refusalJudged,
  };
  mkdirSync(join(process.cwd(), "data/eval"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`results written to data/eval/${resultsFile}`);

  return metrics;
}
