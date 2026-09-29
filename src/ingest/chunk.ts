import type { Section } from "./parse";

// A retrievable unit of text. `content` is the section title plus its text,
// self-contained so a chunk is understandable alone.
//
// Example (shortened):
//   { content: "Artikel 5: (1) Personenbezogene Daten müssen a) …" }
export type Chunk = {
  content: string;
};

export type Chunked = {
  section: Section;
  chunks: Chunk[];
};

// Split a long section into chunks at numbered-paragraph boundaries ("(1)",
// "(2)", …), each under `maxChars`. Chunks never cross article/recital
// boundaries (article-aware).
function splitText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const paragraphs = text.split(/(?=\s*\(\d+\))/);
  const parts: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    if ((buf + " " + p).trim().length > maxChars && buf) {
      parts.push(buf.trim());
      buf = p;
    } else {
      buf = (buf + " " + p).trim();
    }
  }
  if (buf) parts.push(buf.trim());
  return parts;
}

export function chunkSections(sections: Section[], maxChars = 1500): Chunked[] {
  return sections.map((section) => ({
    section,
    chunks: splitText(section.text, maxChars).map((part) => ({
      content: `${section.title}: ${part}`,
    })),
  }));
}
