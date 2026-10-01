import { createMistral } from "@ai-sdk/mistral";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { RetrievedChunk } from "./db/retrieve";

export const mistral = createMistral({
  apiKey: process.env.MISTRAL_API_KEY || undefined,
});

export function chatModel() {
  return mistral.languageModel(process.env.MISTRAL_MODEL ?? "mistral-small-latest");
}

// Judge runs on a separate OpenAI-compatible endpoint (e.g. together.ai), so
// the judge is a different model family than the generator: no self-preference
// bias. Wired via JUDGE_* env vars.
export function judgeModel() {
  if (!process.env.JUDGE_API_KEY || !process.env.JUDGE_MODEL) {
    throw new Error("JUDGE_API_KEY and JUDGE_MODEL must be set for generation eval");
  }
  const judge = createOpenAICompatible({
    name: "judge",
    baseURL: process.env.JUDGE_BASE_URL ?? "https://api.together.xyz/v1",
    apiKey: process.env.JUDGE_API_KEY,
  });
  return judge.chatModel(process.env.JUDGE_MODEL);
}

export function buildContext(retrieved: RetrievedChunk[]): string {
  return retrieved.map((c, i) => `[${i + 1}] ${c.sectionTitle}: ${c.content}`).join("\n\n");
}

export function systemPrompt(retrieved: RetrievedChunk[], profileVisibility: string): string {
  // Standard profile: make the missing DS-GVO permission visible in the answer
  // instead of silently answering from the remaining corpus.
  const permissionNote =
    profileVisibility === "public"
      ? "Das aktive Profil sieht nur die KI-Verordnung. Bezieht sich eine Frage eindeutig auf die DS-GVO, weise darauf hin, dass diese Dokumente für das Profil nicht freigegeben sind, und nenne, dass sich das Profil über den Schalter oben rechts auf Compliance umstellen lässt."
      : "";
  return `Sie sind ein Assistent für EU-Recht (DS-GVO, KI-Verordnung). Antworten Sie auf Deutsch, mit förmlicher Anrede (Sie/Ihre).
Beantworten Sie die Frage nur mit den unten angegebenen Quelltexten und zitieren Sie jede Aussage mit [n], wobei n die Nummer der Quelle ist.
Wenn die Quellen die Frage nicht beantworten können, sagen Sie das ohne jede Erfindung.
${permissionNote}

Quellen:
${buildContext(retrieved)}`;
}
