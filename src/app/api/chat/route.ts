import { createMistral } from "@ai-sdk/mistral";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type LanguageModelUsage,
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
import { systemPrompt as sharedSystemPrompt } from "../../../generate";
import { embedder } from "../../../ingest/embed";
import { getLangfuse } from "../../../langfuse";
import { costFor } from "../../../prices";
import { getReranker } from "../../../rerank";
import { chunkCitation } from "../../citations";
import { limitChat } from "../rate-limit";

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
  const limited = await limitChat(req);
  if (limited) return limited;

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
  const visibility = profile?.visibility ?? "public";

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
    metadata: { profileId: profile?.id ?? null, visibility, promptChars: prompt.length },
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
  let rerankMs: number | undefined;
  let retrieved: RetrievedChunk[];
  if (process.env.RERANK_ENABLED === "true") {
    const reranker = getReranker();
    // Rerank needs a pool larger than the final k to be worth anything.
    const pool = await retrieveHybrid(prompt, embedding, {
      k: RERANK_CANDIDATES,
      candidates: RERANK_CANDIDATES,
      visibility,
    });
    const rerankStart = Date.now();
    retrieved = await reranker.rerank(prompt, pool);
    rerankMs = Date.now() - rerankStart;
  } else {
    retrieved = await retrieveHybrid(prompt, embedding, {
      k: 5,
      visibility,
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
      visibility,
      retrievedCount: retrieved.length,
      ...(rerankMs !== undefined ? { rerankMs } : {}),
    },
  });
  const citations = retrieved.map((c, i) =>
    rerankMs !== undefined ? chunkCitation(c, i + 1) : chunkCitation(c),
  );

  // Only the last few exchanges go to the model: each question retrieves its own
  // chunks, history is only needed to resolve follow-ups.
  const HISTORY_MESSAGES = 6;

  const modelName = process.env.MISTRAL_MODEL ?? "mistral-small-latest";
  // Shared with the eval harness (generate.ts) so the eval measures the shipped
  // prompt: <quelle> delimiters + injection instruction, see there.
  const systemPrompt = sharedSystemPrompt(retrieved, visibility);
  const historyMessages = await convertToModelMessages(messages.slice(-HISTORY_MESSAGES));

  // The system prompt carries the full retrieved chunk content and the
  // permission note, so keying on it means any corpus or profile change misses.
  const answerKey = sha256(JSON.stringify([modelName, systemPrompt, historyMessages, visibility]));
  const cachedAnswer = await getCachedAnswer(answerKey);
  const generationStart = Date.now();
  const upstreamAbort = new AbortController();
  // Client disconnect (reload, Stop button) must abort the upstream call,
  // otherwise the generation runs on for minutes and holds the answer cache
  // open.
  req.signal.addEventListener("abort", () => upstreamAbort.abort(), { once: true });
  const result = cachedAnswer
    ? null
    : streamText({
        model: mistral.languageModel(modelName),
        system: systemPrompt,
        messages: historyMessages,
        abortSignal: upstreamAbort.signal,
        onError: ({ error }) => {
          console.error("chat: generation error", error);
          return "Generierung fehlgeschlagen.";
        },
      });
  // .usage rejects when the stream is aborted; attach the handler early so the
  // rejection is never unhandled.
  const usagePromise =
    (Promise.resolve(result?.usage).catch(() => null) as Promise<LanguageModelUsage | null>) ??
    null;

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
        // Consume the UI stream part by part instead of writer.merge: merge
        // hides the parts from us, and gating the stats line on result.usage
        // (which resolves only when the provider stream formally ends) can
        // hang the whole answer if the upstream lingers.
        let text = "";
        let textStartId: string | undefined;
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        const armWatchdog = () => {
          clearTimeout(watchdog);
          watchdog = setTimeout(() => {
            console.error(
              `chat: no stream part for 30s, aborting upstream (prompt: ${prompt.slice(0, 60)})`,
            );
            upstreamAbort.abort();
          }, 30_000);
        };
        armWatchdog();
        try {
          for await (const part of toUIMessageStream({ stream: result.stream })) {
            armWatchdog();
            writer.write(part);
            if (part.type === "text-delta") text += part.delta;
            if (part.type === "text-start") textStartId = part.id;
          }
        } catch (error) {
          if (req.signal.aborted) {
            // Client is gone (reload/Stop), nothing to clean up for the UI.
            throw error;
          }
          // Watchdog fired or upstream broke mid-answer: close the stream so
          // the UI shows the partial answer with stats instead of hanging.
          console.error("chat: ui stream failed", error);
          if (textStartId !== undefined) writer.write({ type: "text-end", id: textStartId });
          writer.write({ type: "finish" });
        } finally {
          clearTimeout(watchdog);
        }
        answerText = text;
        // usage resolves after the provider stream terminates; race it so a
        // lingering upstream cannot delay the stats line indefinitely.
        const usage = await Promise.race([
          usagePromise,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
        ]);
        if (usage) {
          inputTokens = usage.inputTokens ?? 0;
          outputTokens = usage.outputTokens ?? 0;
          await putCachedAnswer(answerKey, {
            answerText,
            model: modelName,
            inputTokens,
            outputTokens,
            documentIds: [...new Set(retrieved.map((c) => c.documentId))],
          });
        } else {
          console.error(
            "chat: usage did not resolve within 5s of stream end, answer not cached, tokens unknown",
          );
        }
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
        metadata: { promptChars: prompt.length, visibility },
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
