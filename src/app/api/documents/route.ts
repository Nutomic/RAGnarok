import { listDocuments } from "../../../db/documents";
import { limitReads } from "../rate-limit";

// Corpus overview for MCP clients: documents + visibility, so a client can
// discover what exists before searching. Visibility is informational here —
// enforcement stays in the retrieval SQL of /api/search.
export async function GET(req: Request) {
  const limited = await limitReads(req);
  if (limited) return limited;
  return Response.json({ documents: await listDocuments() });
}
