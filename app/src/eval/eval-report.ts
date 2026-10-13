import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as echarts from "echarts";

// Renders the eval artifacts the README slice embeds:
// - data/eval/retrieval.json (from evaluate-retrieval) -> strategy comparison
//   table + grouped bar chart (data/eval/chart.svg, echarts SSR, no canvas)
// - data/eval/generation.json (from judge-generation) -> generation metrics table
//   + grouped bar chart (data/eval/generation.svg, echarts SSR, no canvas)
type GenerationResults = {
  timestamp?: string;
  sha?: string;
  model?: string;
  judge?: string;
  // judge metrics keyed per retrieval strategy: { hybrid: { faithfulness: ... } }
  generation?: Record<string, Record<string, number>>;
};

// One results file per generation provider; eval-report joins them for the
// mistral-vs-local comparison. Legacy single generation.json still loads.
function readGenerationFile(cwd: string, file: string): GenerationResults | null {
  try {
    return JSON.parse(readFileSync(join(cwd, "data/eval", file), "utf8")) as GenerationResults;
  } catch {
    return null;
  }
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function evalReport() {
  const cwd = process.cwd();
  let retrieval: {
    timestamp?: string;
    embeddings_mean_ms?: number;
    strategies?: Record<string, Record<string, number>>;
  } = {};
  try {
    retrieval = JSON.parse(readFileSync(join(cwd, "data/eval/retrieval.json"), "utf8"));
  } catch {
    // eval-report also works with generation results only
  }
  const strategies = retrieval.strategies ?? {};

  const mistralResults =
    readGenerationFile(cwd, "mistral-generation.json") ??
    readGenerationFile(cwd, "generation.json");
  const localResults = readGenerationFile(cwd, "local-generation.json");
  const generationRuns = [mistralResults, localResults].filter(
    (r): r is GenerationResults => r !== null && r.generation !== undefined,
  );

  const strategyRows: string[] = [];
  for (const [name, metrics] of Object.entries(strategies)) {
    strategyRows.push(
      `| ${name} | ${pct(metrics.hit_at_5)} | ${pct(metrics.mrr_at_5)} | ${pct(metrics.context_recall)} | ${metrics.mean_ms.toFixed(1)}ms |`,
    );
  }

  // judge metrics are per retrieval strategy: generation: { hybrid: {...} }
  const GENERATION_METRICS = ["faithfulness", "relevancy", "refusal_rate"] as const;
  const generationRows = generationRuns.flatMap((run) =>
    Object.entries(run.generation ?? {}).map(
      ([strategy, metrics]) =>
        `| \`${run.model}\` | ${strategy} | ${GENERATION_METRICS.map((k) => pct(metrics[k] ?? 0)).join(" | ")} |`,
    ),
  );
  // chart series: one per model x strategy
  const generationSeries = Object.fromEntries(
    generationRuns.flatMap((run) =>
      Object.entries(run.generation ?? {}).map(([strategy, metrics]) => [
        `${run.model} · ${strategy}`,
        metrics,
      ]),
    ),
  );
  // Strategy colors for mistral series; the local series stands out in emerald
  // (the UI accent) since it is the odd one out.
  const STRATEGY_COLORS: Record<string, string> = {
    fts: "#b45309",
    vector: "#0369a1",
    hybrid: "#0f766e",
    rerank: "#7c3aed",
  };
  const localModel = localResults?.model;
  const generationColors = Object.fromEntries(
    Object.keys(generationSeries).map((series) => {
      const strategy = series.split(" · ")[1] ?? "";
      return [
        series,
        series.startsWith(`${localModel} ·`) ? "#4d7c0f" : (STRATEGY_COLORS[strategy] ?? "#78716c"),
      ];
    }),
  );

  if (strategyRows.length === 0 && generationRows.length === 0) {
    console.error(
      "no metrics in data/eval/retrieval.json and data/eval/*-generation.json; run evaluate-retrieval/judge-generation first",
    );
    process.exit(1);
  }

  const meta = [
    generationRuns.length > 0
      ? `Modelle: ${generationRuns.map((r) => `\`${r.model}\``).join(", ")}`
      : null,
    (mistralResults?.judge ?? localResults?.judge)
      ? `Judge: \`${mistralResults?.judge ?? localResults?.judge}\``
      : null,
    mistralResults?.sha && mistralResults.sha !== "unknown"
      ? `Commit: \`${mistralResults.sha}\``
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const md = [
    ...(strategyRows.length > 0
      ? [
          `## Retrieval strategies (golden set, n=23 answerable)`,
          "",
          `| Strategie | hit@5 | mrr@5 | context recall | SQL-Latenz (mean) |`,
          `|---|---|---|---|---|`,
          ...strategyRows,
          "",
          retrieval.embeddings_mean_ms
            ? `_Embedding: ${retrieval.embeddings_mean_ms.toFixed(1)}ms mean (einmal pro Frage) · ${
                retrieval.timestamp ?? ""
              }_`
            : "",
        ]
      : []),
    ...(generationRows.length > 0
      ? [
          `## Generation (LLM-Judge, n=30)`,
          "",
          `| Modell | Strategie | faithfulness | relevancy | refusal rate |`,
          `|---|---|---|---|---|`,
          ...generationRows,
          "",
        ]
      : []),
    `_${meta}_`,
    "",
  ]
    .filter((l) => l !== "")
    .join("\n");
  mkdirSync(join(process.cwd(), "data/eval"), { recursive: true });
  writeFileSync(join(cwd, "data/eval/report.md"), md);

  if (strategyRows.length > 0)
    writeChart(
      "chart.svg",
      ["hit_at_5", "mrr_at_5", "context_recall"],
      {
        hit_at_5: "hit@5",
        mrr_at_5: "mrr@5",
        context_recall: "context recall",
      },
      strategies,
    );
  if (generationRows.length > 0) {
    if (generationRuns.length > 1) {
      // Provider comparison: hybrid only — the one strategy both providers run.
      const comparisonSeries = Object.fromEntries(
        Object.entries(generationSeries).filter(([series]) => series.endsWith(" · hybrid")),
      );
      const comparisonColors = Object.fromEntries(
        Object.entries(generationColors).filter(([series]) => series in comparisonSeries),
      );
      writeChart(
        "generation-comparison.svg",
        ["faithfulness", "relevancy", "refusal_rate"],
        {
          faithfulness: "faithfulness",
          relevancy: "relevancy",
          refusal_rate: "refusal rate",
        },
        comparisonSeries,
        comparisonColors,
      );
    } else {
      // Single provider: keep the per-strategy chart as before.
      writeChart(
        "generation.svg",
        ["faithfulness", "relevancy", "refusal_rate"],
        {
          faithfulness: "faithfulness",
          relevancy: "relevancy",
          refusal_rate: "refusal rate",
        },
        generationSeries,
        generationColors,
      );
    }
  }
  console.log(
    `wrote data/eval/report.md${strategyRows.length > 0 ? " and data/eval/chart.svg" : ""}${
      generationRuns.length > 1
        ? " and data/eval/generation-comparison.svg"
        : generationRows.length > 0
          ? " and data/eval/generation.svg"
          : ""
    }`,
  );
}

// Grouped bars, one metric per row, one bar per series.
function writeChart(
  outFile: string,
  metrics: readonly string[],
  labels: Record<string, string>,
  data: Record<string, Record<string, number>>,
  colors: Record<string, string> = {},
) {
  const names = Object.keys(data);
  const chart = echarts.init(null, null, {
    renderer: "svg",
    ssr: true,
    width: 560,
    height: 280,
  });
  chart.setOption({
    grid: { left: 110, right: 50, top: 10, bottom: 55 },
    xAxis: {
      type: "value",
      max: 1,
      axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%` },
    },
    yAxis: {
      type: "category",
      data: metrics.map((m) => labels[m]).reverse(),
      axisLabel: { fontSize: 13 },
    },
    legend: { bottom: 0, data: names },
    series: names.map((name) => ({
      name,
      type: "bar",
      itemStyle: { color: colors[name] ?? "#78716c" },
      label: {
        show: true,
        position: "right",
        formatter: (p: { value: number }) => `${Math.round(p.value * 100)}%`,
      },
      data: metrics.map((m) => data[name][m]).reverse(),
    })),
  });
  // echarts SSR centers legend text via dominant-baseline="central", which
  // rsvg-based renderers ignore, dropping the label below the 14px icon;
  // re-anchor to an alphabetic baseline (~+4.5px from center) instead
  const svg = chart
    .renderToSVGString()
    .replace(/(<text[^>]*?) dominant-baseline="central"([^>]*x="30" y="7")/g, "$1$2")
    .replace(/x="30" y="7"/g, 'x="30" y="10.5"');
  chart.dispose();
  mkdirSync(join(process.cwd(), "data/eval"), { recursive: true });
  writeFileSync(join(process.cwd(), "data/eval", outFile), `${svg}\n`);
}
