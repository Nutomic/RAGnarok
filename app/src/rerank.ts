import { AutoModelForSequenceClassification, AutoTokenizer } from "@huggingface/transformers";
import type { RetrievedChunk } from "./db/retrieve";

export interface Reranker {
  rerank(query: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]>;
}

type Tokenizer = (
  text: string[],
  options: { text_pair: string[]; padding: boolean; truncation: boolean },
) => unknown;

type Classifier = (inputs: unknown) => Promise<{ logits: { tolist: () => number[][] } }>;

// Cross-encoder re-scoring of the retrieval candidate pool. Opt-in via
// RERANK_ENABLED: measured +0.13 MRR@5 on the golden set, but 1.7-4.7 s per
// query on CPU, which rules it out for the demo hardware.
export class TransformersReranker implements Reranker {
  private readonly modelId = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1";
  private loaded: Promise<{ tokenizer: Tokenizer; model: Classifier }> | null = null;

  private load() {
    this.loaded ??= (async () => {
      const tokenizer = await AutoTokenizer.from_pretrained(this.modelId);
      const model = await AutoModelForSequenceClassification.from_pretrained(this.modelId);
      return {
        tokenizer: tokenizer as unknown as Tokenizer,
        model: model as unknown as Classifier,
      };
    })();
    return this.loaded;
  }

  async rerank(query: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    if (chunks.length === 0) return [];
    const { tokenizer, model } = await this.load();
    const inputs = tokenizer(new Array(chunks.length).fill(query), {
      text_pair: chunks.map((c) => c.content),
      padding: true,
      truncation: true,
    });
    const { logits } = await model(inputs);
    return chunks
      .map((chunk, i) => ({ chunk, score: logits.tolist()[i][0] }))
      .sort((a, b) => b.score - a.score)
      .map((r) => r.chunk);
  }
}

// Lazily-initialized process singleton, shared across requests and the eval benchmark.
let rerankerInstance: TransformersReranker | undefined;

export function getReranker(): TransformersReranker {
  rerankerInstance ??= new TransformersReranker();
  return rerankerInstance;
}
