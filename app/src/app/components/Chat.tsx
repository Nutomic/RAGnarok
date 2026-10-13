import type { UIMessage } from "ai";
import { useEffect, useRef } from "react";
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
      {retrieval} Suche · {(stats.generationMs / 1000).toFixed(1)} s Antwort
      {stats.rerankMs !== undefined && ` · Rerank ${stats.rerankMs} ms`} · Input {stats.inputTokens}{" "}
      / Output {stats.outputTokens} Tokens · {cost}
    </p>
  );
}

// Markdown answer. Badges of the latest answer link to the sources panel;
// older answers link to EUR-Lex directly, since the panel shows the latest.
function Answer({
  text,
  sources,
  latest,
  onCiteClick,
}: {
  text: string;
  sources: Citation[];
  latest: boolean;
  onCiteClick: (chunkId: string) => void;
}) {
  // Also handle sub-citations like [1a]/[1b] for several claims from
  // one source; the letter suffix maps to the same source badge.
  const md = text.replace(/\[(\d+)([a-z]?)\]/g, (marker, n: string, letter: string) => {
    const c = sources[Number(n) - 1];
    if (!c) return marker;
    return latest ? `[${n}${letter}](#quelle-${c.chunkId})` : `[${n}${letter}](${c.url})`;
  });
  return (
    <div className="markdown space-y-2 text-[15px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => {
            // Latest-answer badges highlight the source in panel state; the
            // href stays for middle-click, the click itself never touches the
            // URL. Older answers link out to EUR-Lex directly.
            const chunkId = href?.startsWith("#quelle-") ? href.slice("#quelle-".length) : null;
            return (
              <a
                href={href}
                target={chunkId ? undefined : "_blank"}
                rel={chunkId ? undefined : "noopener noreferrer"}
                onClick={
                  chunkId
                    ? (e) => {
                        e.preventDefault();
                        onCiteClick(chunkId);
                      }
                    : undefined
                }
                className="mx-0.5 rounded bg-emerald-100 px-1 align-super font-mono text-xs text-emerald-800 no-underline hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300"
              >
                {children}
              </a>
            );
          },
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
  onCiteClick,
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
  onCiteClick: (chunkId: string) => void;
}) {
  const busy = status === "submitted" || status === "streaming";
  const tooLong = input.length > MAX_PROMPT_CHARS;
  // Follow the stream only while the user is already near the bottom, so
  // scrolling up to read stays put. The form is the scroll target, not the
  // document bottom: on mobile the sources list continues below the chat and
  // scrolling the page would land there.
  const stickToBottom = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onScroll = () => {
      stickToBottom.current =
        window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // messages is only the trigger: the effect runs on every stream update.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger, not value
  useEffect(() => {
    if (!stickToBottom.current || !formRef.current) return;
    const formBottom = formRef.current.getBoundingClientRect().bottom + window.scrollY;
    window.scrollTo({
      top: Math.max(formBottom - window.innerHeight, 0),
      behavior: "instant",
    });
  }, [messages]);
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
                onCiteClick={onCiteClick}
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
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="mt-auto flex gap-2 rounded-xl border border-stone-200 bg-white p-2 shadow-sm dark:border-stone-800 dark:bg-stone-900"
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
