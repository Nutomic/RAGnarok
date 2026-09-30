import { load } from "cheerio";

// A parsed unit of the regulation. `number` is the citation identifier
// ("Art. 5", "Erwägungsgrund 5") used for sourcing and eval ground truth.
// `anchor` is the id of the enclosing `eli-subdivision` div ("art_5", "rct_5"),
// used to deep-link the chunk on EUR-Lex.
//
// Articles are the binding law (the rules you must comply with); recitals are
// the non-binding preamble that explains the why behind the articles. Both are
// kept because retrieval should surface either depending on the question.
//
// Example:
// {
//  "type": "recital",
//  "number": 5,
//  "title": "Erwägungsgrund 5",
//  "text": "Die wirtschaftliche und soziale Integration als..."
// }
export type Section = {
  type: "recital" | "article";
  number: number;
  title: string;
  text: string;
  anchor: string | null;
};

const RECITAL_NUM = /^\((\d+)\)$/;

// EUR-Lex official-journal HTML: articles are marked with class `oj-ti-art`
// ("Artikel N"), recitals are `oj-normal` paragraphs numbered "(1)", "(2)", …
// that precede the articles. Paragraphs of both live in `oj-normal`, each
// article/recital wrapped in an `eli-subdivision` div with id `art_N`/`rct_N`
// used as the EUR-Lex deep-link anchor.
export function parseEurlex(html: string): Section[] {
  const $ = load(html);
  const sections: Section[] = [];
  let inRecitals = true;
  let current: Section | null = null;

  $("body *").each((_, el) => {
    const cls = $(el).attr("class") ?? "";

    if (cls.includes("oj-ti-art")) {
      const t = $(el).text().trim().replace(/\s+/g, " ");
      const m = t.match(/Artikel\s+(\d+)/i);
      if (m) {
        inRecitals = false;
        current = {
          type: "article",
          number: Number(m[1]),
          title: t,
          text: "",
          anchor: $(el).closest("[id^='art_']").attr("id") ?? null,
        };
        sections.push(current);
      }
      return;
    }

    if (!cls.includes("oj-normal")) return;
    const p = $(el).text().trim().replace(/\s+/g, " ");
    if (!p) return;

    if (inRecitals) {
      const m = p.match(RECITAL_NUM);
      if (m) {
        current = {
          type: "recital",
          number: Number(m[1]),
          title: `Erwägungsgrund ${m[1]}`,
          text: "",
          anchor: $(el).closest("[id^='rct_']").attr("id") ?? null,
        };
        sections.push(current);
      } else if (current?.type === "recital") {
        current.text += (current.text ? " " : "") + p;
      }
    } else if (current?.type === "article") {
      current.text += (current.text ? " " : "") + p;
    }
  });

  return sections;
}
