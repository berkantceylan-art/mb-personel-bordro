import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fiş / fatura carisi" };

type Row = { party_id: string; name: string; currency: string; slips: number; slip_count: number; invoices: number; payments: number; official_balance: number; slip_balance: number; unbilled: number; last_slip: string | null; receipts_waiting: number };
const m = (k: number, cur: string) => `${(k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const bal = (k: number, cur: string) => (k < 0 ? <span className="text-bad">{m(-k, cur)} borcumuz</span> : k > 0 ? <span className="text-ok">{m(k, cur)} alacağımız</span> : <span className="text-muted">0</span>);

/** Tedarikçi fiş / fatura mutabakatı: fiş carisi ve fatura carisi yan yana, ödemeler ikisine de düşer */
export default async function SupplierSlipsPage({ searchParams }: { searchParams: Promise<{ cari?: string }> }) {
  const sp = await searchParams;
  if (sp.cari && /^[0-9a-f-]{36}$/.test(sp.cari)) redirect(`/finans/fis-cari/${sp.cari}`);
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 1 && (s.modules.purchases ?? 0) < 1) redirect("/");
  const supabase = await createClient();
  const [{ data, error }, { data: sups }] = await Promise.all([supabase.rpc("sup_summary"), supabase.from("fin_parties").select("id, name").in("kind", ["supplier", "both"]).order("name").limit(2000)]);
  const rows = (data ?? []) as Row[];
  const tot = (k: keyof Row) => rows.filter((r) => r.currency === "TRY").reduce((n, r) => n + Number(r[k] ?? 0), 0);
  return (
    <>
      <PageHeader title="Fiş / fatura carisi" subtitle="Tedarikçiden fişle gelen mal ↔ sonradan kesilen fatura · ödeme, çek ve senet bir kez girilir, iki cariye de düşer" />
      <div className={page}>
        {error && <Notice tone="bad">Supabase&apos;de 20270111000000_supplier_slips.sql çalıştırılmalı.</Notice>}
        <Notice tone="info">Fiş carisi teslim alınan mala göre operasyonel takip içindir; muhasebe ve stok kayıtları faturaya ve fiilen gelen mala göre tutulur. Fatura, gelen maldan farklı ürünlerle kesilmemelidir.</Notice>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[["Fiş toplamı (TL)", tot("slips")], ["Fatura toplamı (TL)", tot("invoices")], ["Faturası gelmemiş (TL)", tot("unbilled")], ["Ödenen (TL)", tot("payments")]].map(([l, v]) => (
            <div key={l as string} className="rounded-[14px] border border-line bg-white p-4"><span className="text-xs text-muted">{l}</span><b className="block text-xl num">{m(v as number, "")}</b></div>
          ))}
        </div>
        <div className="overflow-x-auto rounded-[14px] border border-line bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="p-3">Tedarikçi</th><th className="p-3 text-right">Fişler</th><th className="p-3 text-right">Faturalar</th><th className="p-3 text-right">Faturası gelmemiş</th><th className="p-3 text-right">Ödenen</th><th className="p-3 text-right">Fiş carisi</th><th className="p-3 text-right">Fatura carisi</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.party_id} className="border-b border-[#EEF2F6] hover:bg-[#F7F9FC]">
                  <td className="p-3"><Link href={`/finans/fis-cari/${r.party_id}`} className="font-semibold text-brand-700">{r.name}</Link><span className="block text-xs text-muted">{r.slip_count} fiş{r.last_slip ? ` · son ${formatDate(r.last_slip)}` : ""}{r.receipts_waiting ? ` · ${r.receipts_waiting} mal kabul fişe işlenmedi` : ""}</span></td>
                  <td className="p-3 text-right num">{m(r.slips, r.currency)}</td>
                  <td className="p-3 text-right num">{m(r.invoices, r.currency)}</td>
                  <td className={`p-3 text-right num font-semibold ${r.unbilled > 0 ? "text-warn" : r.unbilled < 0 ? "text-[#6D28D9]" : "text-muted"}`}>{m(r.unbilled, r.currency)}</td>
                  <td className="p-3 text-right num">{m(r.payments, r.currency)}</td>
                  <td className="p-3 text-right num">{bal(r.slip_balance, r.currency)}</td>
                  <td className="p-3 text-right num">{bal(r.official_balance, r.currency)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="p-6 text-center text-muted">Henüz fiş kaydı olan tedarikçi yok. Bir tedarikçinin sayfasından fiş ekleyin ya da mal kabul yapın.</td></tr>}
            </tbody>
          </table>
        </div>
        <form className="flex flex-wrap items-center gap-2 rounded-[14px] border border-line bg-white p-3">
          <span className="text-sm font-semibold">Tedarikçiye fiş ekle:</span>
          <select name="cari" required className="h-11 min-w-[240px] flex-1 rounded-[10px] border border-[#D5DEE8] px-2 text-sm"><option value="">— Tedarikçi seçin —</option>{((sups ?? []) as { id: string; name: string }[]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <button className="h-11 rounded-[10px] bg-brand-700 px-4 font-semibold text-white">Aç</button>
        </form>
      </div>
    </>
  );
}
