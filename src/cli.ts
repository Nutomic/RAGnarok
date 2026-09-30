import { evalReport } from "./eval-report";
import { evaluateGeneration } from "./evaluate-generation";
import { evaluateRetrieval } from "./evaluate-retrieval";
import { ingest } from "./ingest/run";
import { checkRetrieve } from "./retrieve/check";

function usage(): never {
  console.error(`usage: node cli.js <command>
commands: ingest, check-retrieval, evaluate-retrieval, eval-report`);
  process.exit(1);
}

async function main() {
  const command = process.argv[2];
  if (command === "ingest") {
    await ingest();
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
