import { type ChatStats, fmtCost, PROFILES } from "./types";

export function Header({
  profileId,
  setProfileId,
  chatStats,
}: {
  profileId: string;
  setProfileId: (id: string) => void;
  chatStats: ChatStats | null;
}) {
  return (
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
        {chatStats?.available && (
          <span
            title="Aus Langfuse: p95-Latenz und durchschnittliche Kosten pro Antwort der letzten 100 Anfragen."
            className="cursor-help border-b border-dotted pb-px font-mono text-xs text-stone-400"
          >
            {chatStats.p95LatencyS !== undefined && `p95 ${(chatStats.p95LatencyS).toFixed(1)} s`}
            {chatStats.avgCostEur !== undefined && ` · ø ${fmtCost(chatStats.avgCostEur)}/Antwort`}
            {chatStats.answers !== undefined && ` · ${chatStats.answers} Anfragen`}
          </span>
        )}
      </div>
    </header>
  );
}
