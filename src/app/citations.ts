import type { RetrievedChunk } from "../db/retrieve";

export interface Citation {
  chunkId: string;
  label: string;
  url: string;
  // Rank within the vector and FTS branches before RRF fusion; null = not hit.
  vecRank: number | null;
  ftsRank: number | null;
  excerpt: string;
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
    vecRank: chunk.vecRank,
    ftsRank: chunk.ftsRank,
    excerpt: chunk.content.slice(0, 160),
  };
}
