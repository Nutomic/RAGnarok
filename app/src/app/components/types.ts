import type { UIMessage } from "ai";
import type { Citation } from "../citations";

export interface AnswerStats {
  retrievalMs: number;
  // Cross-encoder rerank latency; present only when reranking is enabled.
  rerankMs?: number;
  generationMs: number;
  inputTokens: number;
  outputTokens: number;
  costEur: number;
  model: string;
  cacheHit?: boolean;
}

export interface ChatStats {
  available: boolean;
  answers?: number;
  p95LatencyS?: number;
  avgCostEur?: number;
  cacheHits?: number;
}

// Must match MAX_PROMPT_CHARS in api/chat/route.ts; importing the route from
// the client would pull the Mistral provider into the browser bundle.
export const MAX_PROMPT_CHARS = 200;

export const EXAMPLE_QUESTIONS = [
  "Wie lange darf ein Unternehmen personenbezogene Daten speichern?",
  "Wann gilt ein KI-System als Hochrisiko-KI-System?",
  "Wie beantrage ich einen Reisepass beim Bürgeramt?",
];

// Seeded in drizzle/0003; the UI switch only changes what retrieval may see.
// Toggle and submit button share the profile accent.
export const PROFILES = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Standard",
    hint: "Sieht nur die KI-Verordnung",
    accent: "bg-emerald-700 text-white hover:bg-emerald-800",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Compliance",
    hint: "Sieht DS-GVO und KI-Verordnung",
    accent: "bg-yellow-500 text-stone-900 hover:bg-yellow-600",
  },
] as const;

export const profileAccent = (id: string) => PROFILES.find((p) => p.id === id)?.accent ?? "";

export function sourcesOf(message: UIMessage): Citation[] {
  const part = message.parts.find((p) => p.type === "data-sources");
  return part && "data" in part ? (part.data as Citation[]) : [];
}

export function statsOf(message: UIMessage): AnswerStats | null {
  const part = message.parts.find((p) => p.type === "data-stats");
  return part && "data" in part ? (part.data as AnswerStats) : null;
}

// Cost in EUR is tiny for this model class; fixed 4-decimal euro so the number
// does not round to 0,00 €. Same value is visible in Langfuse.
export const fmtCost = (eur: number) => `${eur.toFixed(4)} €`;
