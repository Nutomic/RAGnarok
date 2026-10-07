import { getCachedEmbedding, putCachedEmbedding } from "../../../db/cache";
import { retrieveHybrid } from "../../../db/retrieve";
import { embedder } from "../../../ingest/embed";
import { chunkCitation } from "../../citations";
import { limitReads } from "../rate-limit";

// HTTP facade for MCP clients: permission-aware hybrid retrieval without
// generation. Visibility enforcement handled in retrieval SQL, never in the client.
export async function GET(req: Request) {
  const limited = await limitReads(req);
  if (limited) return limited;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) return Response.json({ error: "Missing query parameter q." }, { status: 400 });
  if (q.length > 200) {
    return Response.json({ error: "Query too long (max 200 chars)." }, { status: 400 });
  }

  const kRaw = Number(url.searchParams.get("k") ?? 5);
  if (!Number.isInteger(kRaw) || kRaw < 1 || kRaw > 20) {
    return Response.json({ error: "k must be an integer between 1 and 20." }, { status: 400 });
  }
  const k = kRaw;

  // "public" is the default profile (Standard); "compliance" sees everything.
  const profile = url.searchParams.get("profile") ?? "public";
  if (profile !== "public" && profile !== "compliance") {
    return Response.json({ error: 'profile must be "public" or "compliance".' }, { status: 400 });
  }

  const cachedEmbedding = await getCachedEmbedding(q);
  let embedding: number[];
  if (cachedEmbedding) {
    embedding = cachedEmbedding;
  } else {
    ({ embedding } = await embedder.embed(q, "query"));
    await putCachedEmbedding(q, embedding);
  }

  const retrieved = await retrieveHybrid(q, embedding, { k, visibility: profile });

  return Response.json({
    query: q,
    visibility: profile,
    results: retrieved.map(chunkCitation),
  });
}
