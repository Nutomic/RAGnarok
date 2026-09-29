import { TransformersEmbedder } from "../ingest/embed";
import { retrieveHybrid } from "./retrieve";

interface Query {
  // Question in user language, as a real user would ask it.
  q: string;
  // Content word that identifies the expected chunk.
  kind: string;
  // false = no result expected
  present: boolean;
}

const QUERIES: Query[] = [
  {
    // Overlap with the target chunk (Art. 5(1)(e)): both branches fire.
    q: "Wie lange darf ein Unternehmen personenbezogene Daten speichern?",
    kind: "gespeichert",
    present: true,
  },
  {
    // Exact legal term (Art. 37): FTS branch should carry this.
    q: "Wer muss einen Datenschutzbeauftragten benennen?",
    kind: "Datenschutzbeauftragte",
    present: true,
  },
  {
    // Paraphrase, no legal vocabulary (Art. 8(1): "sechzehnte Lebensjahr",
    // "Kind"): vector branch should carry this.
    q: "Ab welchem Alter dürfen Minderjährige allein zustimmen, wenn ein Online-Dienst direkt an sie gerichtet ist?",
    kind: "sechzehnte",
    present: true,
  },
  {
    // Abstention: passport application has nothing to do with EU law.
    q: "Wie beantrage ich einen Reisepass beim Bürgeramt?",
    kind: "Reisepass",
    present: false,
  },
];

// Retrieval check against the ingested corpus. Runs in the integration test
// after ingest.
export async function checkRetrieve() {
  const embedder = new TransformersEmbedder();

  let failures = 0;
  for (const { q, kind, present } of QUERIES) {
    const { embedding } = await embedder.embed(q, "query");
    const results = await retrieveHybrid(q, embedding, { k: 5 });

    console.log(`\nquery: "${q}"`);
    for (const r of results) {
      console.log(
        `  score=${r.score.toFixed(4)} vec=${r.vecRank ?? "-"} fts=${r.ftsRank ?? "-"} ${r.content.slice(0, 80)}`,
      );
    }

    const hit = results.some((r) => r.content.includes(kind));
    if (hit !== present) {
      console.error(
        present
          ? `FAIL: none of the top results contain "${kind}"`
          : `FAIL: results should not contain "${kind}" but do`,
      );
      failures++;
    }
  }
  if (failures > 0) {
    console.error(`retrieval check failed: ${failures}/${QUERIES.length} queries missed`);
    process.exit(1);
  }
  console.log("\nretrieval check passed");
}
