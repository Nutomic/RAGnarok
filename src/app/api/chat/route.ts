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
import { auditLogs } from "../../../db/schema";
import { TransformersEmbedder } from "../../../ingest/embed";
import { MAX_PROMPT_CHARS } from "../../../lib/limits";
import { chunkCitation } from "../../../retrieve/citations";
import { retrieveHybrid } from "../../../retrieve/retrieve";

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
  const { messages } = (await req.json()) as { messages: UIMessage[] };
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

  const embedder = new TransformersEmbedder();
  const { embedding } = await embedder.embed(prompt, "query");
  const retrieved = await retrieveHybrid(prompt, embedding, { k: 5 });
  const citations = retrieved.map(chunkCitation);

  const context = retrieved
    .map((c, i) => `[${i + 1}] ${c.sectionTitle}: ${c.content}`)
    .join("\n\n");

  // Only the last few exchanges go to the model: each question retrieves its own
  // chunks, history is only needed to resolve follow-ups.
  const HISTORY_MESSAGES = 6;

  const result = streamText({
    model: mistral.languageModel(process.env.MISTRAL_MODEL ?? "mistral-small-latest"),
    system: `Sie sind ein Assistent für EU-Recht (DS-GVO, KI-Verordnung). Antworten Sie auf Deutsch, mit förmlicher Anrede (Sie/Ihre).
Beantworten Sie die Frage nur mit den unten angegebenen Quelltexten und zitieren Sie jede Aussage mit [n], wobei n die Nummer der Quelle ist.
Wenn die Quellen die Frage nicht beantworten können, sagen Sie das ohne jede Erfindung.

Quellen:
${context}`,
    messages: await convertToModelMessages(messages.slice(-HISTORY_MESSAGES)),
    onError: ({ error }) => {
      console.error(error);
      return "Generierung fehlgeschlagen.";
    },
  });

  const stream = createUIMessageStream({
    originalMessages: messages,
    onError: () => "Generierung fehlgeschlagen.",
    execute: async ({ writer }) => {
      writer.write({ type: "data-sources", data: citations });
      writer.merge(toUIMessageStream({ stream: result.stream }));
    },
    onEnd: async () => {
      await db.insert(auditLogs).values({
        prompt,
        model: process.env.MISTRAL_MODEL ?? "ministral-14b-latest",
        chunkIds: retrieved.map((c) => c.id),
      });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
