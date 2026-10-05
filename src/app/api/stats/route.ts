import { sql } from "drizzle-orm";
import { db } from "../../../db";
import { getLangfuseCredentials, LANGFUSE_HOST } from "../../../langfuse";

interface LangfuseTrace {
  latency: number | null;
  totalCost: number | null;
}

interface LangfuseObservation {
  type: string;
  name: string;
}

export interface ChatStats {
  available: boolean;
  answers?: number;
  // p95 over completed traces, seconds
  p95LatencyS?: number;
  avgCostEur?: number;
  retrievalSpans?: number;
  generations?: number;
  // answered from answer_cache instead of the model, audit_logs total
  cacheHits?: number;
}

const CACHE_MS = 30_000;
const TRACE_LIMIT = 100;
let cache: { at: number; stats: ChatStats } | null = null;

// Aggregates over the last TRACE_LIMIT traces via the Langfuse public API,
// cached briefly so the demo UI does not hammer Langfuse on every load.
export async function GET() {
  const headers = await getLangfuseCredentials();
  if (!headers) return Response.json({ available: false } satisfies ChatStats);

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return Response.json(cache.stats);
  }

  let traces: LangfuseTrace[];
  let observations: LangfuseObservation[];
  try {
    const [traceRes, obsRes] = await Promise.all([
      fetch(`${LANGFUSE_HOST}/api/public/traces?limit=${TRACE_LIMIT}`, { headers }),
      fetch(`${LANGFUSE_HOST}/api/public/observations?limit=${TRACE_LIMIT}`, { headers }),
    ]);
    if (!traceRes.ok) throw new Error(`langfuse traces api ${traceRes.status}`);
    if (!obsRes.ok) throw new Error(`langfuse observations api ${obsRes.status}`);
    traces = ((await traceRes.json()) as { data: LangfuseTrace[] }).data;
    observations = ((await obsRes.json()) as { data: LangfuseObservation[] }).data;
  } catch (err) {
    console.error("[stats] langfuse fetch failed:", err);
    return Response.json({ available: false } satisfies ChatStats);
  }

  const latencies = traces.map((t) => t.latency).filter((v): v is number => v !== null);
  const costs = traces.map((t) => t.totalCost).filter((v): v is number => v !== null);
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = sorted.length > 0 ? sorted[Math.ceil(0.95 * sorted.length) - 1] : undefined;
  const avgCost = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : undefined;

  const stats: ChatStats = {
    available: true,
    answers: traces.length,
    p95LatencyS: p95,
    avgCostEur: avgCost,
    retrievalSpans: observations.filter((o) => o.type === "SPAN" && o.name === "retrieval").length,
    generations: observations.filter((o) => o.type === "GENERATION").length,
    cacheHits: (
      await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM audit_logs WHERE cache_hit
    `)
    ).rows[0].n,
  };
  cache = { at: Date.now(), stats };
  return Response.json(stats);
}
