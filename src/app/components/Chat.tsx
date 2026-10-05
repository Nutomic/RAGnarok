import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Citation } from "../citations";
import {
  type AnswerStats,
  EXAMPLE_QUESTIONS,
  fmtCost,
  MAX_PROMPT_CHARS,
  sourcesOf,
  statsOf,
} from "./types";

function StatsLine({ stats }: { stats: AnswerStats }) {
  const retrieval =
    stats.retrievalMs < 1000
      ? `${stats.retrievalMs} ms`
      : `${(stats.retrievalMs / 1000).toFixed(1)} s`;
  const cost = stats.cacheHit ? "aus Cache" : fmtCost(stats.costEur);
  return (
    <p className="mt-2 border-t border-stone-100 pt-2 font-mono text-xs text-stone-400 dark:border-stone-800">
      {retrieval} Suche · {(stats.generationMs / 1000).toFixed(1)} s Antwort · Input{" "}
      {stats.inputTokens} / Output {stats.outputTokens} Tokens · {cost}
    </p>
  );
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

export function Chat({
  messages,
  status,
  error,
  stop,
  lastAnswerId,
  input,
  setInput,
  submit,
  accent,
}: {
  messages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error: Error | undefined;
  stop: () => void;
  lastAnswerId: string | null;
  input: string;
  setInput: (v: string) => void;
  submit: (text: string) => void;
  accent: string;
}) {
  const busy = status === "submitted" || status === "streaming";
  const tooLong = input.length > MAX_PROMPT_CHARS;

  return (
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
            <div>
              <Answer
                text={m.parts
                  .filter((p) => p.type === "text")
                  .map((p) => p.text)
                  .join("")}
                sources={sourcesOf(m)}
                latest={m.id === lastAnswerId}
              />
              {(() => {
                const s = statsOf(m);
                return s ? <StatsLine stats={s} /> : null;
              })()}
            </div>
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
            className={`rounded-lg px-3 py-1.5 text-sm disabled:opacity-40 ${accent}`}
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
  );
}
