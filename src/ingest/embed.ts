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
// multilingual-e5-base: 768-dim, ~1.1 GB, runs on CPU; q8 quantization is
// ~2x faster with much less RAM. e5 models require a "passage: " prefix for
// documents (queries use "query: ").
export class TransformersEmbedder implements Embedder {
  private extractor: Promise<Extractor>;

  constructor() {
    this.extractor = pipeline("feature-extraction", "Xenova/multilingual-e5-base", {
      dtype: "q8",
    }) as unknown as Promise<Extractor>;
  }

  async embed(text: string, mode: "passage" | "query" = "passage"): Promise<EmbedResult> {
    const ex = await this.extractor;
    const prefixed = `${mode}: ${text}`;
    const tokens = (await ex.tokenizer(prefixed)).input_ids.data.length;
    const output = await ex(prefixed, { pooling: "mean", normalize: true });
    return { embedding: Array.from(output.data), tokens };
  }
}

// Shared instance; warmed up via instrumentation register() so the first
// request does not pay the model load.
export const embedder = new TransformersEmbedder();
