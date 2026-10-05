import { deleteDocumentByTitle } from "./db/delete";
import { evalReport } from "./eval/eval-report";
import { evaluateGeneration } from "./eval/evaluate-generation";
import { evaluateRetrieval } from "./eval/evaluate-retrieval";
import { checkRetrieve } from "./eval/retrieval-check";
import { ingest } from "./ingest/run";

function usage(): never {
  console.error(`usage: node cli.js <command>
commands: ingest, delete <title>, check-retrieval, evaluate-retrieval, evaluate-generation, eval-report`);
  process.exit(1);
}

async function main() {
  const command = process.argv[2];
  if (command === "ingest") {
    await ingest();
  } else if (command === "delete") {
    const title = process.argv[3];
    if (!title) {
      console.error("delete: title argument required");
      process.exit(1);
    }
    const result = await deleteDocumentByTitle(title);
    if (!result) {
      console.error(`no document with title: ${title}`);
      process.exit(1);
    }
    console.log(
      `deleted ${result.title}: ${result.chunksDeleted} chunks, ` +
        `${result.embeddingsDeleted} embeddings removed`,
    );
  } else if (command === "check-retrieval") {
    await checkRetrieve();
  } else if (command === "evaluate-retrieval") {
    await evaluateRetrieval();
  } else if (command === "evaluate-generation") {
    await evaluateGeneration();
  } else if (command === "eval-report") {
    evalReport();
  } else {
    usage();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
