import Link from "next/link";
import { moveInGroup } from "@/lib/admin-actions";
import { RowActions } from "./RowActions";

export type SimpleRow = { id: string; title: string; subtitle?: string; thumb?: string | null; round?: boolean; active: boolean; trashed: boolean };

/** Sıralanabilir basit liste (ekip, departmanlar): gruplar, yukarı/aşağı, yayın/çöp düğmeleri */
export function SimpleList({
  table,
  editBase,
  groups,
  trash,
  empty,
}: {
  table: "cms_team" | "cms_departments";
  editBase: string;
  groups: { label?: string; rows: SimpleRow[] }[];
  trash: boolean;
  empty: string;
}) {
  const visible = groups.filter((g) => g.rows.length);
  if (!visible.length) return <div className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center text-slate">{empty}</div>;
  return (
    <div className="grid gap-8">
      {visible.map((g, gi) => (
        <section key={g.label ?? gi}>
          {g.label && (
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate">
              {g.label} <span className="num font-normal">({g.rows.length})</span>
            </h2>
          )}
          <ul className="divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
            {g.rows.map((r, i) => (
              <li key={r.id} className="grid gap-4 p-4 sm:grid-cols-[auto_auto_1fr_auto] sm:items-center">
                {!trash ? (
                  <div className="flex gap-1 sm:flex-col">
                    {(["up", "down"] as const).map((dir) => (
                      <form key={dir} action={moveInGroup}>
                        <input type="hidden" name="table" value={table} />
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="dir" value={dir} />
                        <button
                          type="submit"
                          disabled={(dir === "up" && i === 0) || (dir === "down" && i === g.rows.length - 1)}
                          aria-label={dir === "up" ? "Yukarı taşı" : "Aşağı taşı"}
                          className="grid h-7 w-7 place-items-center rounded-full border border-gypsum text-slate hover:border-navy hover:text-navy disabled:opacity-30"
                        >
                          {dir === "up" ? "▲" : "▼"}
                        </button>
                      </form>
                    ))}
                  </div>
                ) : (
                  <span />
                )}
                {r.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumb} alt="" className={`h-14 object-cover ${r.round ? "w-14 rounded-full" : "w-20 rounded-lg"}`} />
                ) : (
                  <span className={`grid h-14 place-items-center bg-porcelain text-xs text-slate ${r.round ? "w-14 rounded-full" : "w-20 rounded-lg"}`}>—</span>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`${editBase}/${r.id}`} className="font-semibold text-navy hover:underline">
                      {r.title}
                    </Link>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.trashed ? "bg-bad-bg text-bad" : r.active ? "bg-ok-bg text-ok" : "bg-gypsum text-slate"}`}>
                      {r.trashed ? "Çöpte" : r.active ? "Yayında" : "Taslak"}
                    </span>
                  </div>
                  {r.subtitle && <p className="mt-1 truncate text-sm text-slate">{r.subtitle}</p>}
                </div>
                <RowActions table={table} id={r.id} active={r.active} trashed={r.trashed} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
