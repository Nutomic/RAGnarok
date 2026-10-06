import { listDocuments } from "../../../db/documents";

// Corpus overview for MCP clients: documents + visibility, so a client can
// discover what exists before searching. Visibility is informational here —
// enforcement stays in the retrieval SQL of /api/search.
export async function GET() {
  return Response.json({ documents: await listDocuments() });
}
