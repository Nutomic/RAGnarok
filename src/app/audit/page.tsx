import { sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "../../db";
import { costFor } from "../../prices";
import { citationUrl } from "../citations";
import { fmtCost } from "../components/types";

interface AuditRow extends Record<string, unknown> {
  id: string;
  createdAt: string;
  prompt: string;
  model: string | null;
  profileName: string | null;
  inputTokens: number;
  outputTokens: number;
  chunkIds: string[];
}

// Section metadata for the cited chunks, so a reviewer can check the sources
// without leaving the table.
interface ChunkRef {
  label: string;
  url: string;
}

interface ChunkRow extends Record<string, unknown> {
  id: string;
  celex: string | null;
  anchor: string | null;
  section_type: string;
  section_number: number;
}

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const rows = await db.execute<AuditRow>(sql`
    SELECT a.id, to_char(a.created_at, 'DD.MM.YYYY HH24:MI') AS "createdAt", a.prompt, a.model,
           p.name AS "profileName", a.input_tokens AS "inputTokens",
           a.output_tokens AS "outputTokens", a.chunk_ids AS "chunkIds"
    FROM audit_logs a
    LEFT JOIN demo_profiles p ON p.id = a.profile_id
    ORDER BY a.created_at DESC
    LIMIT 100
  `);

  const chunkIds = [...new Set(rows.rows.flatMap((r) => r.chunkIds ?? []))];
  const chunks = chunkIds.length
    ? await db.execute<{
        id: string;
        celex: string | null;
        anchor: string | null;
        section_type: string;
        section_number: number;
      }>(sql`
        SELECT c.id, d.celex, c.anchor, c.section_type, c.section_number
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE c.id = ANY(${sql.param(chunkIds)}::uuid[])
      `)
    : { rows: [] as ChunkRow[] };
  const chunkRefs = new Map<string, ChunkRef>(
    chunks.rows.map((c) => [
      c.id,
      {
        label:
          c.section_type === "article"
            ? `Artikel ${c.section_number}`
            : `Erwägungsgrund ${c.section_number}`,
        url: c.celex ? citationUrl(c.celex, c.anchor) : "",
      },
    ]),
  );

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
        {rows.rows.length === 0 ? (
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
                  <th className="py-2 pr-4 font-medium">Modell</th>
                  <th className="py-2 pr-4 font-medium">Quellen</th>
                  <th className="py-2 pr-4 text-right font-medium">Tokens (Input/Output)</th>
                  <th className="py-2 text-right font-medium">Kosten</th>
                </tr>
              </thead>
              <tbody>
                {rows.rows.map((r) => {
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
                      <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs">
                        {r.model ?? "-"}
                      </td>
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
                        {cost !== null ? fmtCost(cost) : "-"}
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
