import Link from "next/link";
import { chunkRefsFor, listAuditEntries } from "../../db/audit";
import { costFor } from "../../prices";
import { fmtCost } from "../components/types";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const rows = await listAuditEntries();
  const chunkRefs = await chunkRefsFor([...new Set(rows.flatMap((r) => r.chunkIds ?? []))]);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-stone-200 px-4 py-3 sm:px-6 dark:border-stone-800">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
          <div>
            <h1 className="font-serif text-xl tracking-tight">Audit-Protokoll</h1>
            <p className="text-sm text-stone-600 dark:text-stone-300">
              Jede Antwort mit Anfrage, Modell, Quellen und Tokenverbrauch.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            Zurück zum Chat
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:px-6">
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          Öffentliche Demo, in einem produktiven Einsatz wäre diese Ansicht authentifiziert.
          Einträge werden automatisch nach 14 Tagen gelöscht, es werden keine IP-Adressen
          gespeichert.
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Noch keine Einträge. Sobald der Chat benutzt wird, landet jede Anfrage hier.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-stone-300 text-left text-stone-500 dark:border-stone-700 dark:text-stone-400">
                  <th className="py-2 pr-4 font-medium">Zeitpunkt</th>
                  <th className="py-2 pr-4 font-medium">Profil</th>
                  <th className="py-2 pr-4 font-medium">Anfrage</th>
                  <th className="py-2 pr-4 font-medium">Quellen</th>
                  <th className="py-2 pr-4 text-right font-medium">Tokens (Input/Output)</th>
                  <th className="py-2 text-right font-medium">Kosten</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const cost = r.model ? costFor(r.model, r.inputTokens, r.outputTokens) : null;
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-stone-200 align-top dark:border-stone-800"
                    >
                      <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs text-stone-600 dark:text-stone-400">
                        {r.createdAt}
                      </td>
                      <td className="py-2 pr-4">{r.profileName ?? "-"}</td>
                      <td className="max-w-md py-2 pr-4">{r.prompt}</td>
                      <td className="py-2 pr-4">
                        <ul className="space-y-0.5">
                          {(r.chunkIds ?? []).map((id) => {
                            const ref = chunkRefs.get(id);
                            return (
                              <li key={id}>
                                {ref?.url ? (
                                  <a
                                    href={ref.url}
                                    className="text-emerald-700 underline decoration-stone-300 underline-offset-2 hover:decoration-emerald-700 dark:text-emerald-400"
                                  >
                                    {ref.label}
                                  </a>
                                ) : (
                                  (ref?.label ?? id)
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4 text-right font-mono text-xs">
                        {r.inputTokens} / {r.outputTokens}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right font-mono text-xs">
                        {r.cacheHit ? (
                          <span
                            title="Antwort aus dem Antwortcache, kein Modellaufruf."
                            className="rounded bg-stone-100 px-1 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
                          >
                            Cache
                          </span>
                        ) : cost !== null ? (
                          fmtCost(cost)
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
