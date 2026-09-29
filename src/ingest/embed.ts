import { pipeline } from "@huggingface/transformers";

export interface Embedder {
  embed(text: string): Promise<number[]>;
}

type Extractor = (
  text: string,
  options: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array }>;

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

  async embed(text: string): Promise<number[]> {
    const ex = await this.getExtractor();
    const output = await ex(`passage: ${text}`, { pooling: "mean", normalize: true });
    return Array.from(output.data);
  }
}
