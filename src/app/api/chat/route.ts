import { createMistral } from "@ai-sdk/mistral";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { db } from "../../../db";
import { hasChunks } from "../../../db/has-chunks";
import { retrieveHybrid } from "../../../db/retrieve";
import { auditLogs } from "../../../db/schema";
import { embedder } from "../../../ingest/embed";
import { getLangfuse } from "../../../langfuse";
import { costFor } from "../../../prices";
import { chunkCitation } from "../../citations";

// Reject oversized prompts before LLM call
export const MAX_PROMPT_CHARS = 200;

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
  const profile = profileId
    ? await db.query.demoProfiles.findFirst({
        where: (p, { eq }) => eq(p.id, profileId),
      })
    : undefined;
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
  const { embedding } = await embedder.embed(prompt, "query");
  const retrieved = await retrieveHybrid(prompt, embedding, {
    k: 5,
    profileVisibility,
  });
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
    metadata: { k: 5, profileVisibility, retrievedCount: retrieved.length },
  });
  const citations = retrieved.map(chunkCitation);

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
  const generationStart = Date.now();
  const systemPrompt = `Sie sind ein Assistent für EU-Recht (DS-GVO, KI-Verordnung). Antworten Sie auf Deutsch, mit förmlicher Anrede (Sie/Ihre).
Beantworten Sie die Frage nur mit den unten angegebenen Quelltexten und zitieren Sie jede Aussage mit [n], wobei n die Nummer der Quelle ist.
Wenn die Quellen die Frage nicht beantworten können, sagen Sie das ohne jede Erfindung.
${permissionNote}

Quellen:
${context}`;
  const historyMessages = await convertToModelMessages(messages.slice(-HISTORY_MESSAGES));
  const result = streamText({
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

  const stream = createUIMessageStream({
    originalMessages: messages,
    onError: () => "Generierung fehlgeschlagen.",
    execute: async ({ writer }) => {
      writer.write({ type: "data-sources", data: citations });
      writer.merge(toUIMessageStream({ stream: result.stream }));
      // usage/text resolve when the model stream finishes; then the answer's
      // stats are appended as a data part for the UI.
      const usage = await result.usage;
      const text = await result.text;
      const generationMs = Date.now() - generationStart;
      inputTokens = usage.inputTokens ?? 0;
      outputTokens = usage.outputTokens ?? 0;
      const cost = costFor(modelName, inputTokens, outputTokens);
      writer.write({
        type: "data-stats",
        data: {
          retrievalMs,
          generationMs,
          inputTokens,
          outputTokens,
          costEur: cost,
          model: modelName,
        },
      });
      trace?.generation({
        name: "answer",
        model: modelName,
        startTime: new Date(generationStart),
        endTime: new Date(),
        input: { system: systemPrompt, messages: historyMessages },
        output: text,
        usage: {
          input: inputTokens,
          output: outputTokens,
          total: usage.totalTokens ?? inputTokens + outputTokens,
          unit: "TOKENS",
        },
        metadata: { promptChars: prompt.length, profileVisibility },
      });
    },
    onEnd: async () => {
      await db.insert(auditLogs).values({
        profileId: profile?.id ?? null,
        prompt,
        model: modelName,
        chunkIds: retrieved.map((c) => c.id),
        inputTokens,
        outputTokens,
      });
      await langfuse?.flushAsync();
    },
  });

  return createUIMessageStreamResponse({ stream });
}
