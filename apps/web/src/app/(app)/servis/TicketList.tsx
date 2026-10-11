import Link from "next/link";
import { formatDate } from "@/lib/session";
import { SVC_KIND, SVC_PRIORITY, SVC_STATUS, svcNo, tl } from "@/lib/service";

export type TicketRow = { id: string; year: number; no: number; kind: string; title: string; location: string | null; priority: string; status: string; cost: number; due_date: string | null; created_at: string; reported_by: string | null; technician_user: string | null; vendor: string | null; assets: { name: string; code: string | null } | null };
export const TICKET_COLS = "id, year, no, kind, title, location, priority, status, cost, due_date, created_at, reported_by, technician_user, vendor, assets(name, code)";

export function TicketList({ rows, names, empty = "Kayıt yok." }: { rows: TicketRow[]; names: Map<string, string>; empty?: string }) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((t) => {
        const [label, cls] = SVC_STATUS[t.status] ?? SVC_STATUS.reported!;
        const [pl, pcls] = SVC_PRIORITY[t.priority] ?? SVC_PRIORITY.normal!;
        const late = t.due_date && t.due_date < new Date().toISOString().slice(0, 10) && !["closed", "rejected", "cancelled"].includes(t.status);
        return (
          <li key={t.id}>
            <Link href={`/servis/${t.id}`} className="bg-white border border-line rounded-[14px] p-4 flex flex-wrap items-center gap-3 hover:border-brand-600">
              <span className="w-28"><b className="num block">{svcNo(t)}</b><span className="text-[11px] text-muted">{SVC_KIND[t.kind]}</span></span>
              <span className="flex-1 min-w-[200px]"><b>{t.title}</b><span className="block text-xs text-muted">{[t.assets ? `${t.assets.name}${t.assets.code ? ` · ${t.assets.code}` : ""}` : null, t.location, t.reported_by ? `bildiren: ${names.get(t.reported_by) ?? "—"}` : "otomatik"].filter(Boolean).join(" · ")}</span></span>
              <span className="text-xs w-36 text-muted">{t.technician_user ? `🔧 ${names.get(t.technician_user) ?? "—"}` : t.vendor ? `🏢 ${t.vendor}` : ""}</span>
              <span className={`text-xs w-16 ${pcls}`}>{pl}</span>
              {t.cost > 0 && <span className="num text-sm w-24 text-right">{tl(t.cost)} TL</span>}
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${cls}`}>{label}</span>
              <span className={`text-xs w-20 text-right ${late ? "text-bad font-semibold" : "text-muted"}`}>{t.due_date ? `hedef ${formatDate(t.due_date)}` : formatDate(t.created_at.slice(0, 10))}</span>
            </Link>
          </li>
        );
      })}
      {!rows.length && <li className="rounded-[14px] border border-dashed border-[#C5D0DB] p-6 text-center text-sm text-muted">{empty}</li>}
    </ul>
  );
}

