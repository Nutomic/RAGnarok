"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MAX_PROMPT_CHARS } from "../lib/limits";
import type { Citation } from "../retrieve/citations";

const EXAMPLE_QUESTIONS = [
  "Wie lange darf ein Unternehmen personenbezogene Daten speichern?",
  "Wann gilt ein KI-System als Hochrisiko-KI-System?",
  "Wie beantrage ich einen Reisepass beim Bürgeramt?",
];

// Seeded in drizzle/0003; the UI switch only changes what retrieval may see.
// Toggle and submit button share the profile accent.
const PROFILES = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Standard",
    hint: "Sieht nur die KI-Verordnung",
    accent: "bg-emerald-700 text-white hover:bg-emerald-800",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Compliance",
    hint: "Sieht DS-GVO und KI-Verordnung",
    accent: "bg-yellow-500 text-stone-900 hover:bg-yellow-600",
  },
] as const;

const profileAccent = (id: string) => PROFILES.find((p) => p.id === id)?.accent ?? "";

function sourcesOf(message: UIMessage): Citation[] {
  const part = message.parts.find((p) => p.type === "data-sources");
  return part && "data" in part ? (part.data as Citation[]) : [];
}

// Markdown answer. Badges of the latest answer link to the sources panel;
// older answers link to EUR-Lex directly, since the panel shows the latest.
function Answer({ text, sources, latest }: { text: string; sources: Citation[]; latest: boolean }) {
  const md = text.replace(/\[(\d+)\]/g, (marker, n: string) => {
    const c = sources[Number(n) - 1];
    if (!c) return marker;
    return latest ? `[${n}](#quelle-${c.chunkId})` : `[${n}](${c.url})`;
  });
  return (
    <div className="markdown space-y-2 text-[15px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a
              href={href}
              target={href?.startsWith("#") ? undefined : "_blank"}
              rel={href?.startsWith("#") ? undefined : "noopener noreferrer"}
              className="mx-0.5 rounded bg-emerald-100 px-1 align-super font-mono text-xs text-emerald-800 no-underline hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300"
            >
              {children}
            </a>
          ),
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
      <span className="dot-pulse size-2 rounded-full bg-emerald-600" />
      Suche in Quellen, generiere Antwort…
    </div>
  );
}

export default function Home() {
  const { messages, sendMessage, status, error, stop } = useChat();
  const [input, setInput] = useState("");
  const [profileId, setProfileId] = useState<string>(PROFILES[0].id);
  // Sources of the shown answer, held in state so a new question clears the
  // panel immediately and it fills again when the new answer's parts arrive.
  const [sources, setSources] = useState<Citation[]>([]);
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const busy = status === "submitted" || status === "streaming";
  const tooLong = input.length > MAX_PROMPT_CHARS;
  const lastAnswer = [...messages].reverse().find((m) => m.role === "assistant");

  useEffect(() => {
    if (!lastAnswer || lastAnswer.id === answeredId) return;
    const s = sourcesOf(lastAnswer);
    if (s.length > 0) {
      setSources(s);
      setAnsweredId(lastAnswer.id);
    }
  }, [lastAnswer, answeredId]);

  function submit(text: string) {
    if (!text.trim() || text.length > MAX_PROMPT_CHARS || busy) return;
    setInput("");
    setSources([]);
    sendMessage({ text }, { body: { profileId } });
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-stone-200 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between dark:border-stone-800">
        <div>
          <h1 className="font-serif text-xl tracking-tight">RAGnarok</h1>
          <p className="text-sm text-stone-600 dark:text-stone-300">
            Frag DS-GVO und KI-Verordnung. Jede Antwort mit Quelle.
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 md:items-end">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Profil</span>
            <div
              title="Demo-Profile statt Login: schaltet, welche Dokumente die Suche sieht."
              className="flex items-center gap-1 rounded-lg border border-stone-200 p-1 text-sm dark:border-stone-800"
            >
              {PROFILES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.hint}
                  onClick={() => setProfileId(p.id)}
                  className={
                    profileId === p.id
                      ? `rounded-md px-2.5 py-1 ${p.accent}`
                      : "rounded-md px-2.5 py-1 text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
                  }
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <span className="text-[13px] text-stone-600 dark:text-stone-300">
            {PROFILES.find((p) => p.id === profileId)?.hint}
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-1 flex-col gap-4 md:flex-row">
          <section className="flex min-w-0 flex-1 flex-col gap-3">
            {messages.length === 0 && !busy && (
              <p className="mt-8 text-center text-sm text-stone-400">Noch keine Frage gestellt.</p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-3xl rounded-2xl rounded-br-sm bg-stone-800 px-4 py-2 text-[15px] text-stone-50 dark:bg-stone-700"
                    : "max-w-3xl rounded-2xl rounded-bl-sm border border-stone-200 bg-white px-4 py-3 dark:border-stone-800 dark:bg-stone-900"
                }
              >
                {m.role === "assistant" ? (
                  <Answer
                    text={m.parts
                      .filter((p) => p.type === "text")
                      .map((p) => p.text)
                      .join("")}
                    sources={sourcesOf(m)}
                    latest={m.id === lastAnswer?.id}
                  />
                ) : (
                  m.parts
                    .filter((p) => p.type === "text")
                    .map((p) => p.text)
                    .join("")
                )}
              </div>
            ))}
            {status === "submitted" && <Loading />}
            {error && <p className="text-sm text-red-600">{error.message}</p>}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(input);
              }}
              className="sticky bottom-4 mt-auto flex gap-2 rounded-xl border border-stone-200 bg-white p-2 shadow-sm dark:border-stone-800 dark:bg-stone-900"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={MAX_PROMPT_CHARS}
                placeholder="Frage stellen"
                className="min-w-0 flex-1 bg-transparent px-2 text-[15px] outline-none"
              />
              <span className="self-center text-xs text-stone-400">
                {input.length}/{MAX_PROMPT_CHARS}
              </span>
              {busy ? (
                <button
                  type="button"
                  onClick={() => stop()}
                  className="rounded-lg bg-stone-200 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-300 dark:bg-stone-700 dark:text-stone-200"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={tooLong || !input.trim()}
                  className={`rounded-lg px-3 py-1.5 text-sm disabled:opacity-40 ${profileAccent(profileId)}`}
                >
                  Fragen stellen
                </button>
              )}
            </form>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={busy}
                  onClick={() => submit(q)}
                  className="rounded-full border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-700 hover:border-emerald-600 hover:bg-emerald-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-emerald-500 dark:hover:bg-stone-800"
                >
                  {q}
                </button>
              ))}
            </div>
          </section>

          <aside className="w-full shrink-0 self-start md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:w-80 md:overflow-y-auto">
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
              Quellen ({sources.length})
            </h2>
            {status === "submitted" && (
              <div className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <span className="dot-pulse size-2 rounded-full bg-emerald-600" />
                Suche Quellen…
              </div>
            )}
            <ul className="flex flex-col gap-2">
              {sources.map((c, i) => (
                <li
                  key={c.chunkId}
                  id={`quelle-${c.chunkId}`}
                  className="scroll-mt-4 rounded-lg border border-stone-200 bg-white p-3 text-sm target:border-emerald-600 target:bg-emerald-50 target:ring-1 target:ring-emerald-600 dark:border-stone-800 dark:bg-stone-900 dark:target:border-emerald-500 dark:target:bg-emerald-950"
                >
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-emerald-800 underline decoration-emerald-300 underline-offset-2 dark:text-emerald-300"
                  >
                    [{i + 1}] {c.label}
                  </a>
                  <span className="ml-2 font-mono text-xs text-stone-400">
                    <span
                      title={c.vecRank ? `Platz ${c.vecRank} in der Vektorsuche` : undefined}
                      className="cursor-help"
                    >
                      vec {c.vecRank ?? "–"}
                    </span>
                    {" · "}
                    <span
                      title={c.ftsRank ? `Platz ${c.ftsRank} in der Volltextsuche` : undefined}
                      className="cursor-help"
                    >
                      fts {c.ftsRank ?? "–"}
                    </span>
                  </span>
                  <p className="mt-1 text-[13px] leading-snug text-stone-600 dark:text-stone-400">
                    {c.excerpt}…
                  </p>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </main>
    </div>
  );
}
