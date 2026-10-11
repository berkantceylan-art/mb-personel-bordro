import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, EmptyRow, Money, Notice, Table, Tabs, btnSecondary, inputCls, page, td, tdNum } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { dateOk } from "@/lib/fin";
import { bulkEinvoice } from "@/lib/invoice-actions";
import { DIRECTION, EINV_STATUS, INV_STATUS, PROFILES, type Direction } from "@/lib/invoice";

export type ListSP = { durum?: string; ef?: string; ara?: string; bas?: string; bit?: string };

/** Fatura listesi (satış / alış ortak) */
export async function InvoiceList({ direction, sp }: { direction: Direction; sp: ListSP }) {
  const s = await getSession();
  const D = DIRECTION[direction];
  const lvl = s.modules[D.module] ?? 0;
  if (lvl < 1) redirect("/");
  const supabase = await createClient();
  let q = supabase.from("inv_invoices").select("id, no, type, status, doc_no, profile, invoice_date, due_date, party_id, party_name, party_tax_no, currency, subtotal, vat_total, total, einvoice_status, source")
    .eq("direction", direction).order("invoice_date", { ascending: false }).order("no", { ascending: false }).limit(500);
  if (sp.durum && INV_STATUS[sp.durum]) q = q.eq("status", sp.durum);
  if (sp.ef && EINV_STATUS[sp.ef]) q = q.eq("einvoice_status", sp.ef);
  if (dateOk(sp.bas)) q = q.gte("invoice_date", sp.bas!);
  if (dateOk(sp.bit)) q = q.lte("invoice_date", sp.bit!);
  const term = (sp.ara ?? "").trim().replace(/[%,()]/g, " ").slice(0, 60);
  if (term) q = q.or(`party_name.ilike.%${term}%,doc_no.ilike.%${term}%,party_tax_no.eq.${term}`);
  const { data, error } = await q;
  type Row = { id: string; no: number; type: string; status: string; doc_no: string | null; profile: string; invoice_date: string; due_date: string | null; party_id: string; party_name: string | null; party_tax_no: string | null; currency: string; subtotal: number; vat_total: number; total: number; einvoice_status: string; source: string };
  const rows = (data ?? []) as Row[];
  const base = `${D.base}/faturalar`;
  const qs = (patch: Partial<ListSP>) => { const u = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]); const t = u.toString(); return t ? `${base}?${t}` : base; };
  const posted = rows.filter((r) => r.status === "posted");
  const sumBy = (cur: string) => posted.filter((r) => r.currency === cur).reduce((t, r) => t + (r.type === "return" ? -1 : 1) * Number(r.total), 0);
  const curs = [...new Set(posted.map((r) => r.currency))];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title={D.plural} subtitle={`${rows.length} fatura${curs.length ? " · toplam " + curs.map((c) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: c }).format(sumBy(c) / 100)).join(" + ") : ""}`}
        actions={<span className="flex gap-4 text-sm font-semibold">
          {direction === "purchase" && lvl >= 2 && <Link href="/alis/ice-aktar" className="text-brand-700">e-Fatura içe aktar</Link>}
          {direction === "sale" && lvl >= 2 && <Link href="/satis/isler" className="text-brand-700">İşlerden fatura</Link>}
          {lvl >= 2 && <Link href={`${D.base}/yeni`} className="text-brand-700">+ Yeni fatura</Link>}
        </span>} />
      <div className={page}>
        {error && <Notice tone="bad">Fatura tabloları yok: Supabase&apos;de 20261204000000_invoices.sql çalıştırın.</Notice>}
        <Tabs active={qs({})} items={[[qs({ durum: undefined }), "Tümü"], [qs({ durum: "draft" }), "Taslak"], [qs({ durum: "posted" }), "Kesilen"], [qs({ durum: "cancelled" }), "İptal"],
          ...(direction === "sale" ? [[qs({ ef: sp.ef === "ready" ? undefined : "ready" }), sp.ef === "ready" ? "✓ Gönderime hazır" : "Gönderime hazır"] as [string, string]] : [])]} />
        <form className="grid gap-2 grid-cols-2 md:grid-cols-5">
          {sp.durum && <input type="hidden" name="durum" value={sp.durum} />}
          <input name="ara" defaultValue={term} placeholder="Cari, VKN ya da fatura no" className={`${inputCls} col-span-2`} />
          <input type="date" name="bas" defaultValue={sp.bas ?? ""} aria-label="Başlangıç" className={inputCls} />
          <input type="date" name="bit" defaultValue={sp.bit ?? ""} aria-label="Bitiş" className={inputCls} />
          <button className={btnSecondary}>Süz</button>
        </form>
        <form action={bulkEinvoice} className="flex flex-col gap-3">
          <Table head={[direction === "sale" ? "" : null, "Tarih", "Fatura no", D.party, "Tür", "Matrah", "KDV", "Toplam", "Vade", "Durum", direction === "sale" ? "e-Fatura" : "Kaynak"].filter((h) => h !== null)} min={1080}>
            {rows.map((r) => (
              <tr key={r.id} className={r.status === "cancelled" ? "opacity-50" : ""}>
                {direction === "sale" && <td className={td}>{r.status === "posted" && <input type="checkbox" name="ids" value={r.id} aria-label="Seç" />}</td>}
                <td className={td}>{formatDate(r.invoice_date)}</td>
                <td className={td}><Link href={`/fatura/${r.id}`} className="font-semibold text-brand-700 num">{r.doc_no ?? `Taslak #${r.no}`}</Link></td>
                <td className={td}><Link href={`/finans/cariler/${r.party_id}`} className="hover:underline">{r.party_name}</Link>{r.party_tax_no && <span className="block text-xs text-muted num">{r.party_tax_no}</span>}</td>
                <td className={td}>{r.type === "return" ? <Chip tone="amber">İade</Chip> : <span className="text-xs">{PROFILES[r.profile] ?? r.profile}</span>}</td>
                <td className={tdNum}><Money v={r.subtotal} cur={r.currency} /></td>
                <td className={tdNum}><Money v={r.vat_total} cur={r.currency} /></td>
                <td className={tdNum}><Money v={r.total} cur={r.currency} strong /></td>
                <td className={`${td} ${r.status === "posted" && r.due_date && r.due_date < today ? "text-bad font-semibold" : ""}`}>{r.due_date ? formatDate(r.due_date) : ""}</td>
                <td className={td}><Chip tone={INV_STATUS[r.status]?.[1]}>{INV_STATUS[r.status]?.[0]}</Chip></td>
                <td className={td}>{direction === "sale" ? (r.status === "posted" ? <Chip tone={EINV_STATUS[r.einvoice_status]?.[1]}>{EINV_STATUS[r.einvoice_status]?.[0]}</Chip> : "") : <span className="text-xs text-muted">{r.source === "ubl" ? "e-Fatura XML" : "Elle"}</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && <EmptyRow cols={11} text="Fatura yok." />}
          </Table>
          {direction === "sale" && rows.some((r) => r.status === "posted") && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Seçilenler:</span>
              <PendingSubmit name="status" value="sent" className={btnSecondary}>Gönderildi işaretle</PendingSubmit>
              <PendingSubmit name="status" value="accepted" className={btnSecondary}>Kabul edildi işaretle</PendingSubmit>
              <ZipHint />
            </div>
          )}
        </form>
      </div>
    </>
  );
}

function ZipHint() {
  return <Link href="/api/fatura/zip?durum=ready" className="text-sm font-semibold text-brand-700 ml-auto">Gönderime hazır tümünü XML (ZIP) indir</Link>;
}
