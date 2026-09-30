import { ingest } from "./ingest/run";
import { evaluateRetrieval } from "./evaluate-retrieval";
import { checkRetrieve } from "./retrieve/check";

function usage(): never {
  console.error(`usage: node cli.js <command>
commands: ingest, check-retrieval, evaluate-retrieval, evaluate-generation`);
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
    console.error("not implemented yet (tier 2)");
    process.exit(1);
  } else {
    usage();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
