import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, Notice, Tabs, btnSecondary, inputCls, page, td, tdNum, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { VOUCHER_KIND, VOUCHER_SOURCE, VOUCHER_STATUS } from "@/lib/gl";
import { glRepost } from "@/lib/gl-actions";

export const dynamic = "force-dynamic";

type V = { id: string; year: number; no: number; journal_no: number | null; voucher_date: string; kind: string; source: string; status: string; description: string | null; issues: string | null; doc_type: string | null; doc_no: string | null; total: number; fin_txn_id: string | null };

/** Muhasebe fişleri */
export default async function Vouchers({ searchParams }: { searchParams: Promise<{ durum?: string; bas?: string; bit?: string; q?: string; kaynak?: string; s?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const st = ["posted", "pending", "excluded", "cancelled", "all"].includes(sp.durum ?? "") ? sp.durum! : "posted";
  const pg = Math.max(0, Number(sp.s) || 0);
  const supabase = await createClient();
  let q = supabase.from("gl_vouchers").select("*", { count: "exact" }).order("voucher_date", { ascending: false }).order("no", { ascending: false }).range(pg * 200, pg * 200 + 199);
  if (st !== "all") q = q.eq("status", st);
  if (sp.bas && /^\d{4}-\d{2}-\d{2}$/.test(sp.bas)) q = q.gte("voucher_date", sp.bas);
  if (sp.bit && /^\d{4}-\d{2}-\d{2}$/.test(sp.bit)) q = q.lte("voucher_date", sp.bit);
  if (sp.kaynak && sp.kaynak in VOUCHER_SOURCE) q = q.eq("source", sp.kaynak);
  if (sp.q?.trim()) { const t = sp.q.trim().replace(/[%,()]/g, ""); q = q.or(/^\d+$/.test(t) ? `no.eq.${t},doc_no.ilike.%${t}%` : `description.ilike.%${t}%,doc_no.ilike.%${t}%,issues.ilike.%${t}%`); }
  const [{ data, error, count }, { data: cnt }] = await Promise.all([q, supabase.from("gl_vouchers").select("status")]);
  const rows = (data ?? []) as V[];
  const counts = ((cnt ?? []) as Array<{ status: string }>).reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
  const link = (p: Record<string, string | null>) => { const u = new URLSearchParams(); Object.entries({ durum: st, bas: sp.bas ?? null, bit: sp.bit ?? null, q: sp.q ?? null, kaynak: sp.kaynak ?? null, ...p }).forEach(([k, v]) => v && u.set(k, v)); return `/muhasebe/fisler?${u}`; };
  return (
    <>
      <PageHeader title="Muhasebe fişleri" subtitle="ERP kayıtlarından otomatik oluşan ve elle girilen fişler" actions={(s.modules.ledger ?? 0) >= 2 ? <Link href="/muhasebe/fisler/yeni" className="text-sm font-semibold text-brand-700">+ Elle fiş</Link> : undefined} />
      <div className={page}>
        {error && <Notice tone="bad">Supabase&apos;de 20270206000000_gl_core.sql çalıştırılmalı.</Notice>}
        <Tabs active={link({ durum: st })} items={[[link({ durum: "posted" }), "Kayıtlı", counts.posted ?? 0], [link({ durum: "pending" }), "Eşleştirme bekleyen", counts.pending ?? 0], [link({ durum: "excluded" }), "Muhasebe dışı", counts.excluded ?? 0], [link({ durum: "cancelled" }), "İptal", counts.cancelled ?? 0], [link({ durum: "all" }), "Tümü"]]} />
        {st === "pending" && (counts.pending ?? 0) > 0 && (
          <Notice tone="warn">Bu kayıtların hesabı tanımlı değil. <Link href="/muhasebe/eslestirme" className="font-semibold underline">Eşleştirmeden</Link> hesap kodunu girin, sonra <form action={glRepost} className="inline"><PendingSubmit className="font-semibold underline">yeniden deneyin</PendingSubmit></form>.</Notice>
        )}
        <form className="flex flex-wrap gap-2 items-end">
          <input type="hidden" name="durum" value={st} />
          <input type="date" name="bas" defaultValue={sp.bas ?? ""} className={`${inputCls} w-40`} />
          <input type="date" name="bit" defaultValue={sp.bit ?? ""} className={`${inputCls} w-40`} />
          <select name="kaynak" defaultValue={sp.kaynak ?? ""} className={`${inputCls} w-40`}><option value="">Tüm kaynaklar</option>{Object.entries(VOUCHER_SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Fiş no, belge no, açıklama" className={`${inputCls} w-64`} />
          <button className={btnSecondary}>Süz</button>
          {st === "posted" && <Link href={`/yazdir/muhasebe/fis?bas=${sp.bas ?? ""}&bit=${sp.bit ?? ""}`} target="_blank" className="ml-auto text-sm font-semibold text-brand-700 self-center">🖨 Dönemin fişlerini yazdır</Link>}
        </form>
        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead><tr className="text-xs text-muted"><th className={th}>Fiş</th><th className={th}>Tarih</th><th className={th}>Tür</th><th className={th}>Açıklama</th><th className={th}>Belge</th><th className={`${th} text-right`}>Tutar</th><th className={th}>Durum</th></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td className={`${td} num`}><Link href={`/muhasebe/fisler/${v.id}`} className="font-semibold text-brand-700">{v.year}/{v.no}</Link>{v.journal_no && <span className="block text-xs text-muted">yevmiye {v.journal_no}</span>}</td>
                  <td className={`${td} whitespace-nowrap`}>{formatDate(v.voucher_date)}</td>
                  <td className={td}>{VOUCHER_KIND[v.kind] ?? v.kind}<span className="block text-xs text-muted">{VOUCHER_SOURCE[v.source] ?? v.source}</span></td>
                  <td className={td}>{v.description}{v.issues && <span className={`block text-xs ${v.status === "pending" ? "text-bad" : "text-muted"}`}>{v.issues}</span>}</td>
                  <td className={`${td} text-xs`}>{v.doc_no}</td>
                  <td className={tdNum}>{v.total ? fmt(v.total) : "—"}</td>
                  <td className={td}><Chip tone={VOUCHER_STATUS[v.status]?.[1] ?? "gray"}>{VOUCHER_STATUS[v.status]?.[0] ?? v.status}</Chip></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="py-10 text-center text-muted">Fiş yok.</td></tr>}
            </tbody>
          </table>
        </section>
        {(count ?? 0) > 200 && (
          <div className="flex gap-3 text-sm">{pg > 0 && <Link href={link({ s: String(pg - 1) })} className="text-brand-700 font-semibold">← Önceki</Link>}<span className="text-muted">{pg * 200 + 1}–{Math.min((pg + 1) * 200, count ?? 0)} / {count}</span>{(pg + 1) * 200 < (count ?? 0) && <Link href={link({ s: String(pg + 1) })} className="text-brand-700 font-semibold">Sonraki →</Link>}</div>
        )}
      </div>
    </>
  );
}
