import { ingest } from "./ingest/run";
import { checkRetrieve } from "./retrieve/check";

function usage(): never {
  console.error(`usage: node cli.js <command>
commands: ingest, check-retrieve`);
  process.exit(1);
}

async function main() {
  const command = process.argv[2];
  if (command === "ingest") {
    await ingest();
  } else if (command === "check-retrieve") {
    await checkRetrieve();
  } else {
    usage();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
