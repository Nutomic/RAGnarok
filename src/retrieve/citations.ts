import type { RetrievedChunk } from "./retrieve";

export interface Citation {
  chunkId: string;
  label: string;
  url: string;
}

// Deep links use the EUR-Lex HTML view; its `art_N`/`rct_N` anchors match the
// `eli-subdivision` ids from the ingested source HTML.
export function citationUrl(celex: string, anchor: string | null): string {
  const base = `https://eur-lex.europa.eu/legal-content/DE/TXT/HTML/?uri=CELEX:${celex}`;
  return anchor ? `${base}#${anchor}` : base;
}

export function chunkCitation(chunk: RetrievedChunk): Citation {
  const label =
    chunk.sectionType === "article"
      ? `Artikel ${chunk.sectionNumber}`
      : `Erwägungsgrund ${chunk.sectionNumber}`;
  return {
    chunkId: chunk.id,
    label,
    url: chunk.celex ? citationUrl(chunk.celex, chunk.anchor) : "",
  };
}
