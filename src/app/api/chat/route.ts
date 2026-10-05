import { createMistral } from "@ai-sdk/mistral";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { insertAuditLog } from "../../../db/audit";
import {
  getCachedAnswer,
  getCachedEmbedding,
  putCachedAnswer,
  putCachedEmbedding,
  sha256,
} from "../../../db/cache";
import { hasChunks } from "../../../db/has-chunks";
import { findProfileById } from "../../../db/profiles";
import type { RetrievedChunk } from "../../../db/retrieve";
import { retrieveHybrid } from "../../../db/retrieve";
import { embedder } from "../../../ingest/embed";
import { getLangfuse } from "../../../langfuse";
import { costFor } from "../../../prices";
import { getReranker } from "../../../rerank";
import { chunkCitation } from "../../citations";

// Reject oversized prompts before LLM call
export const MAX_PROMPT_CHARS = 200;

// Candidate pool size for the opt-in cross-encoder reranker.
const RERANK_CANDIDATES = 20;

const mistral = createMistral({
  apiKey: process.env.MISTRAL_API_KEY || undefined,
});

function userPrompt(messages: UIMessage[]): string {
  const last = messages.findLast((m) => m.role === "user");
  return last
    ? last.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n")
    : "";
}

export async function POST(req: Request) {
  const { messages, profileId } = (await req.json()) as {
    messages: UIMessage[];
    profileId?: string;
  };
  const prompt = userPrompt(messages);

  if (!prompt.trim()) {
    return Response.json({ error: "Leere Anfrage." }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return Response.json(
      { error: `Anfrage zu lang (max. ${MAX_PROMPT_CHARS} Zeichen).` },
      { status: 400 },
    );
  }

  // Demo profiles replace auth: visibility is enforced in the retrieval SQL.
  // Without a profile id the default (Standard, public-only) profile applies.
  const profile = profileId ? await findProfileById(profileId) : undefined;
  if (profileId && !profile) {
    return Response.json({ error: "Unbekanntes Profil." }, { status: 400 });
  }
  const profileVisibility = profile?.visibility ?? "public";

  // If no documents were ingested, fail loudly instead of silently hallucinating.
  if (!(await hasChunks())) {
    return Response.json(
      {
        error:
          "Kein Dokument im Index. Ingest ausführen: docker compose run --rm app npm run cli -- ingest",
      },
      { status: 503 },
    );
  }

  const langfuse = await getLangfuse();
  const trace = langfuse?.trace({
    name: "chat",
    metadata: { profileId: profile?.id ?? null, profileVisibility, promptChars: prompt.length },
  });

  const retrievalStart = Date.now();
  const cachedEmbedding = await getCachedEmbedding(prompt);
  let embedding: number[];
  if (cachedEmbedding) {
    embedding = cachedEmbedding;
  } else {
    ({ embedding } = await embedder.embed(prompt, "query"));
    await putCachedEmbedding(prompt, embedding);
  }
  const reranker = getReranker();
  let rerankMs: number | undefined;
  let retrieved: RetrievedChunk[];
  if (reranker) {
    // Rerank needs a pool larger than the final k to be worth anything.
    const pool = await retrieveHybrid(prompt, embedding, {
      k: RERANK_CANDIDATES,
      candidates: RERANK_CANDIDATES,
      profileVisibility,
    });
    const rerankStart = Date.now();
    retrieved = await reranker.rerank(prompt, pool);
    rerankMs = Date.now() - rerankStart;
  } else {
    retrieved = await retrieveHybrid(prompt, embedding, {
      k: 5,
      profileVisibility,
    });
  }
  const retrievalMs = Date.now() - retrievalStart;
  trace?.span({
    name: "retrieval",
    startTime: new Date(retrievalStart),
    endTime: new Date(),
    input: prompt,
    output: retrieved.map((c) => ({
      id: c.id,
      section: `${c.sectionType} ${c.sectionNumber}`,
      vecRank: c.vecRank,
      ftsRank: c.ftsRank,
      score: Number(c.score.toFixed(6)),
    })),
    metadata: {
      k: 5,
      profileVisibility,
      retrievedCount: retrieved.length,
      ...(rerankMs !== undefined ? { rerankMs } : {}),
    },
  });
  const citations = retrieved.map((c, i) =>
    rerankMs !== undefined ? chunkCitation(c, i + 1) : chunkCitation(c),
  );

  const context = retrieved
    .map((c, i) => `[${i + 1}] ${c.sectionTitle}: ${c.content}`)
    .join("\n\n");

  // Only the last few exchanges go to the model: each question retrieves its own
  // chunks, history is only needed to resolve follow-ups.
  const HISTORY_MESSAGES = 6;

  // Standard profile: make the missing DS-GVO permission visible in the answer
  // instead of silently answering from the remaining corpus.
  const permissionNote =
    profileVisibility === "public"
      ? "Das aktive Profil sieht nur die KI-Verordnung. Bezieht sich eine Frage eindeutig auf die DS-GVO, weise darauf hin, dass diese Dokumente für das Profil nicht freigegeben sind, und nenne, dass sich das Profil über den Schalter oben rechts auf Compliance umstellen lässt."
      : "";

  const modelName = process.env.MISTRAL_MODEL ?? "mistral-small-latest";
  const systemPrompt = `Sie sind ein Assistent für EU-Recht (DS-GVO, KI-Verordnung). Antworten Sie auf Deutsch, mit förmlicher Anrede (Sie/Ihre).
Beantworten Sie die Frage nur mit den unten angegebenen Quelltexten und zitieren Sie jede Aussage mit [n], wobei n die Nummer der Quelle ist.
Wenn die Quellen die Frage nicht beantworten können, sagen Sie das ohne jede Erfindung.
${permissionNote}

Quellen:
${context}`;
  const historyMessages = await convertToModelMessages(messages.slice(-HISTORY_MESSAGES));

  // The system prompt carries the full retrieved chunk content and the
  // permission note, so keying on it means any corpus or profile change misses.
  const answerKey = sha256(
    JSON.stringify([modelName, systemPrompt, historyMessages, profileVisibility]),
  );
  const cachedAnswer = await getCachedAnswer(answerKey);
  const generationStart = Date.now();
  const result = cachedAnswer
    ? null
    : streamText({
        model: mistral.languageModel(modelName),
        system: systemPrompt,
        messages: historyMessages,
        onError: ({ error }) => {
          console.error(error);
          return "Generierung fehlgeschlagen.";
        },
      });

  // usage/text resolve when the model stream finishes; assigned in execute and
  // read again in onEnd for the audit insert.
  let inputTokens = 0;
  let outputTokens = 0;
  let answerText = "";

  const stream = createUIMessageStream({
    originalMessages: messages,
    onError: () => "Generierung fehlgeschlagen.",
    execute: async ({ writer }) => {
      writer.write({ type: "data-sources", data: citations });
      if (cachedAnswer) {
        inputTokens = cachedAnswer.inputTokens;
        outputTokens = cachedAnswer.outputTokens;
        answerText = cachedAnswer.answerText;
        writer.write({ type: "text-start", id: "cached" });
        writer.write({ type: "text-delta", id: "cached", delta: cachedAnswer.answerText });
        writer.write({ type: "text-end", id: "cached" });
        // The generation path gets this from toUIMessageStream; the replay
        // must emit it too or the UI never sees the stream as complete.
        writer.write({ type: "finish" });
      } else if (result) {
        writer.merge(toUIMessageStream({ stream: result.stream }));
        const usage = await result.usage;
        answerText = await result.text;
        inputTokens = usage.inputTokens ?? 0;
        outputTokens = usage.outputTokens ?? 0;
        await putCachedAnswer(answerKey, {
          answerText,
          model: modelName,
          inputTokens,
          outputTokens,
        });
      }
      const generationMs = Date.now() - generationStart;
      // A cached answer cost nothing: no model call happened.
      const cost = cachedAnswer ? 0 : costFor(modelName, inputTokens, outputTokens);
      writer.write({
        type: "data-stats",
        data: {
          retrievalMs,
          ...(rerankMs !== undefined ? { rerankMs } : {}),
          generationMs,
          inputTokens,
          outputTokens,
          costEur: cost,
          model: modelName,
          cacheHit: cachedAnswer !== null,
        },
      });
      trace?.generation({
        name: "answer",
        model: modelName,
        startTime: new Date(generationStart),
        endTime: new Date(),
        input: { system: systemPrompt, messages: historyMessages },
        output: answerText,
        usage: {
          input: inputTokens,
          output: outputTokens,
          total: inputTokens + outputTokens,
          unit: "TOKENS",
        },
        metadata: { promptChars: prompt.length, profileVisibility },
      });
    },
    onEnd: async () => {
      await insertAuditLog({
        profileId: profile?.id ?? null,
        prompt,
        model: modelName,
        chunkIds: retrieved.map((c) => c.id),
        inputTokens,
        outputTokens,
        cacheHit: cachedAnswer !== null,
      });
      await langfuse?.flushAsync();
    },
  });

  return createUIMessageStreamResponse({ stream });
}
