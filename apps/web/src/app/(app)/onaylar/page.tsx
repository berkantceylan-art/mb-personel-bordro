import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { decideApproval } from "@/lib/approval-actions";

export const dynamic = "force-dynamic";

type I = { id: string; entity: string; entity_id: string; title: string | null; link: string | null; amount: number; step: number; steps: number; step_label: string | null; requested_by_name: string | null; created_at: string };
type M = { id: string; entity: string; title: string | null; link: string | null; status: string; step: number; steps: number; created_at: string; decided_at: string | null };
const ENT: Record<string, string> = { expense_claim: "Masraf", purchase_order: "Satın alma" };
const ST: Record<string, [string, string]> = { pending: ["Bekliyor", "text-warn"], approved: ["Onaylandı", "text-ok"], rejected: ["Reddedildi", "text-bad"], cancelled: ["İptal", "text-muted"] };

/** Onay kutusu: bana düşen onaylar ve benim taleplerim */
export default async function ApprovalsPage() {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data, error }, { data: mine }] = await Promise.all([
    supabase.rpc("apr_inbox"),
    supabase.from("apr_requests").select("id, entity, title, link, status, step, steps, created_at, decided_at").eq("requested_by", s.userId).order("created_at", { ascending: false }).limit(30),
  ]);
  const inbox = (data ?? []) as I[];
  const my = (mine ?? []) as M[];
  const canAdmin = s.role === "owner" || (s.modules.users ?? 0) >= 3;

  return (
    <>
      <PageHeader title="Onaylar" subtitle="Onay akışında sizi bekleyen masraf ve satın alma talepleri" actions={canAdmin ? <Link href="/yonetim/onay-akislari" className="text-sm font-semibold text-brand-700">Onay akışları</Link> : undefined} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1100px]">
        {error && <Notice tone="bad">Supabase&apos;de 20261226000000_approvals.sql çalıştırılmalı.</Notice>}
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-bold">Onayımı bekleyenler ({inbox.length})</h2>
          {inbox.map((r) => (
            <article key={r.id} className="rounded-[18px] border border-line bg-white p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex-1 min-w-[220px]">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">{ENT[r.entity] ?? r.entity} · adım {r.step}/{r.steps}{r.step_label ? ` · ${r.step_label}` : ""}</span>
                  <b className="block">{r.title}</b>
                  <span className="text-xs text-muted">{r.requested_by_name ?? "—"} · {formatDate(r.created_at.slice(0, 10))}</span>
                </div>
                <b className="font-display text-xl">{fmt(r.amount)}</b>
                {r.link && <Link href={r.link} className="text-sm font-semibold text-brand-700">Belgeyi aç</Link>}
              </div>
              <form action={decideApproval} className="flex flex-wrap gap-2 items-center">
                <input type="hidden" name="id" value={r.id} />
                <input name="note" maxLength={500} placeholder="Not (ret için zorunlu)" className="h-10 flex-1 min-w-[200px] rounded-[10px] border border-line px-3 text-sm" />
                <PendingSubmit name="decision" value="approve" className="h-10 px-4 rounded-[10px] bg-ok text-white text-sm font-semibold">Onayla</PendingSubmit>
                <PendingSubmit name="decision" value="reject" className="h-10 px-4 rounded-[10px] border border-bad text-bad text-sm font-semibold">Reddet</PendingSubmit>
              </form>
            </article>
          ))}
          {inbox.length === 0 && <p className="rounded-[18px] border border-dashed border-[#C5D0DB] p-6 text-center text-sm text-muted">Onayınızı bekleyen talep yok.</p>}
        </section>
        {my.length > 0 && (
          <section className="rounded-[18px] border border-line bg-white p-4">
            <h2 className="font-semibold mb-2">Taleplerim</h2>
            <ul className="divide-y divide-[#EEF2F6] text-sm">
              {my.map((m) => (
                <li key={m.id} className="py-2 flex flex-wrap gap-3 items-center">
                  <span className="text-xs text-muted w-20">{ENT[m.entity]}</span>
                  <span className="flex-1">{m.link ? <Link href={m.link} className="text-brand-700">{m.title}</Link> : m.title}</span>
                  <span className={`text-xs font-semibold ${ST[m.status]?.[1]}`}>{ST[m.status]?.[0]}{m.status === "pending" ? ` · adım ${m.step}/${m.steps}` : ""}</span>
                  <span className="text-xs text-muted">{formatDate(m.created_at.slice(0, 10))}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
