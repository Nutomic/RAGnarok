import { pipeline } from "@huggingface/transformers";

export interface EmbedResult {
  embedding: number[];
  tokens: number;
}

export interface Embedder {
  embed(text: string, mode?: "passage" | "query"): Promise<EmbedResult>;
}

type Extractor = {
  tokenizer: (
    text: string,
    options?: unknown,
  ) => Promise<{ input_ids: { data: ArrayLike<number> } }>;
} & ((
  text: string,
  options: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array }>);

// In-process embeddings via transformers.js (ONNX). No separate service.
// multilingual-e5-small: 384-dim, ~470 MB, runs on CPU. e5 models require a
// "passage: " prefix for documents (queries use "query: ").
export class TransformersEmbedder implements Embedder {
  private extractor: Extractor | null = null;

  private async getExtractor() {
    if (!this.extractor) {
      this.extractor = (await pipeline(
        "feature-extraction",
        "Xenova/multilingual-e5-small",
      )) as unknown as Extractor;
    }
    return this.extractor;
  }

  async embed(text: string, mode: "passage" | "query" = "passage"): Promise<EmbedResult> {
    const ex = await this.getExtractor();
    const prefixed = `${mode}: ${text}`;
    const tokens = (await ex.tokenizer(prefixed)).input_ids.data.length;
    const output = await ex(prefixed, { pooling: "mean", normalize: true });
    return { embedding: Array.from(output.data), tokens };
  }
}
