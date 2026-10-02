import type { Citation } from "../citations";

export function Sources({ sources, searching }: { sources: Citation[]; searching: boolean }) {
  return (
    <aside className="w-full shrink-0 self-start md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:w-80 md:overflow-y-auto">
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
        Quellen ({sources.length})
      </h2>
      {searching && (
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
                className="cursor-help border-b border-dotted"
              >
                vec {c.vecRank ?? "-"}
              </span>
              {" · "}
              <span
                title={c.ftsRank ? `Platz ${c.ftsRank} in der Volltextsuche` : undefined}
                className="cursor-help border-b border-dotted"
              >
                fts {c.ftsRank ?? "-"}
              </span>
            </span>
            <p className="mt-1 text-[13px] leading-snug text-stone-600 dark:text-stone-400">
              {c.excerpt}…
            </p>
          </li>
        ))}
      </ul>
    </aside>
  );
}
