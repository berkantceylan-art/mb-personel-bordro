import Link from "next/link";
import { removeRow } from "@/lib/growth-actions";

/** Basit liste: başlık, alt bilgi, düzenle / sitede gör / kaldır */
export function SimpleRows({ table, rows, empty }: { table: string; rows: Array<{ id: string; title: string; sub?: string; href: string; view?: string; draft?: boolean }>; empty: string }) {
  return (
    <ul className="divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 p-4">
          <Link href={r.href} className="font-semibold text-navy hover:underline">{r.title}</Link>
          {r.sub && <span className="text-xs text-slate">{r.sub}</span>}
          {r.draft && <span className="text-xs font-semibold text-bad">taslak</span>}
          <span className="ml-auto flex gap-3 text-sm">
            {r.view && <a href={r.view} target="_blank" rel="noreferrer" className="text-slate hover:text-navy">Gör ↗</a>}
            <form action={removeRow}><input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={r.id} /><button className="text-bad">Kaldır</button></form>
          </span>
        </li>
      ))}
      {!rows.length && <li className="p-8 text-center text-slate">{empty}</li>}
    </ul>
  );
}
