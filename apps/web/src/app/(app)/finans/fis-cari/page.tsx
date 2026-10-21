import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { openSlipParty } from "@/lib/supplier-actions";
import { PendingSubmit } from "@/components/ConfirmSubmit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fişli / faturalı cariler" };

type Pair = { main_id: string; name: string; currency: string; invoice_balance: number; invoices: number; slip_id: string; slip_name: string; slip_balance: number; slips: number; payments: number; last_slip: string | null; receipts_waiting: number; slip_currency?: string | null };
const m = (k: number, cur: string) => `${(Math.abs(k) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const Bal = ({ v, cur }: { v: number; cur: string }) => (v < 0 ? <span className="text-bad font-semibold">{m(v, cur)} <small className="font-normal">borcumuz</small></span> : v > 0 ? <span className="text-ok font-semibold">{m(v, cur)} <small className="font-normal">alacağımız</small></span> : <span className="text-muted">0</span>);

/** Aynı firmanın iki carisi: faturalı alım carisi ve fişli (faturasız) alım carisi; ödeme ikisine de aynı tutarla düşer */
export default async function SlipPairsPage({ searchParams }: { searchParams: Promise<{ cari?: string }> }) {
  const sp = await searchParams;
  if (sp.cari && /^[0-9a-f-]{36}$/.test(sp.cari)) redirect(`/finans/fis-cari/${sp.cari}`);
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 1 && (s.modules.purchases ?? 0) < 1) redirect("/");
  const canEdit = (s.modules.finance ?? 0) >= 2 || (s.modules.purchases ?? 0) >= 2;
  const supabase = await createClient();
  const [{ data, error }, { data: sups }] = await Promise.all([
    supabase.rpc("sup_pairs"),
    supabase.from("fin_parties").select("id, name").in("kind", ["supplier", "both"]).is("slip_of", null).order("name").limit(2000),
  ]);
  const rows = (data ?? []) as Pair[];
  const paired = new Set(rows.map((r) => r.main_id));
  return (
    <>
      <PageHeader title="Fişli / faturalı cariler" subtitle="Aynı firmanın iki carisi: faturayla aldıklarımız ve fişle (faturasız) aldıklarımız" />
      <div className={page}>
        {error && <Notice tone="bad">Supabase&apos;de 20270129000000_slip_party.sql çalıştırılmalı.</Notice>}
        <section className="grid gap-3 md:grid-cols-3">
          {[
            ["1", "Mal gelince", "Mal kabulde firmayı seçip “Faturalı” ya da “Fişli (faturasız)” deyin. Fişli seçilen mal, onaylanınca firmanın fişli carisine borç yazılır."],
            ["2", "Fatura gelince", "Faturalı alımın faturası her zamanki gibi Alış faturası olarak girilir ve faturalı cariye yazılır. Fişli alımın faturası gelmez, gerek de yok."],
            ["3", "Ödeyince", "Ödeme, çek ya da senedi bir kez, iki cariden birine girin. Aynı tutar öbür cariye de otomatik düşer. İptal ederseniz ikisinden de kalkar."],
          ].map(([n, t, d]) => (
            <div key={n} className="rounded-[16px] border border-line bg-white p-4 flex gap-3">
              <span className="w-8 h-8 shrink-0 rounded-full bg-brand-700 text-white grid place-items-center font-bold">{n}</span>
              <div><b className="text-brand-800">{t}</b><p className="text-sm text-muted mt-0.5">{d}</p></div>
            </div>
          ))}
        </section>

        <div className="overflow-x-auto rounded-[16px] border border-line bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted bg-[#F7F9FB]">
              <th className="p-3">Firma</th><th className="p-3 text-right">🧾 Faturalı cari</th><th className="p-3 text-right">📄 Fişli cari</th><th className="p-3 text-right">Ödenen</th><th className="p-3" />
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.main_id} className="border-b border-[#EEF2F6] hover:bg-[#F7F9FC]">
                  <td className="p-3">
                    <Link href={`/finans/fis-cari/${r.main_id}`} className="font-semibold text-brand-700">{r.name}</Link>
                    <span className="block text-xs text-muted">{r.last_slip ? `son fiş ${formatDate(r.last_slip)}` : "fiş yok"}{r.receipts_waiting ? ` · ⚠ ${r.receipts_waiting} mal kabulün tutarı girilmedi` : ""}</span>
                  </td>
                  <td className="p-3 text-right"><Bal v={r.invoice_balance} cur={r.currency} /><span className="block text-[11px] text-muted">fatura {m(r.invoices, r.currency)}</span></td>
                  <td className="p-3 text-right"><Bal v={r.slip_balance} cur={r.slip_currency ?? r.currency} /><span className="block text-[11px] text-muted">fiş {m(r.slips, r.slip_currency ?? r.currency)}</span></td>
                  <td className="p-3 text-right num">{m(r.payments, r.currency)}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <Link href={`/finans/islem?tur=payment&cari=${r.main_id}&geri=/finans/fis-cari/${r.main_id}`} className="text-xs font-semibold text-brand-700">+ Ödeme</Link>
                    <Link href={`/finans/fis-cari/${r.main_id}`} className="ml-3 text-xs font-semibold text-brand-700">Ekstre →</Link>
                    {canEdit && <Link href={`/finans/fis-cari/${r.main_id}?sil=1#sil`} className="ml-3 text-xs font-semibold text-bad">Sil</Link>}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="p-8 text-center text-muted">Henüz fişli carisi olan firma yok. Aşağıdan bir tedarikçiye fişli cari açın ya da mal kabulde “Fişli” seçin.</td></tr>}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <form action={openSlipParty} className="flex flex-wrap items-center gap-2 rounded-[16px] border border-line bg-white p-3">
            <span className="text-sm font-semibold">Firmaya fişli cari aç:</span>
            <select name="cari" required className="h-11 min-w-[240px] flex-1 rounded-[10px] border border-[#D5DEE8] px-2 text-sm" aria-label="Tedarikçi">
              <option value="">— Tedarikçi seçin —</option>
              {((sups ?? []) as { id: string; name: string }[]).filter((p) => !paired.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <PendingSubmit className="h-11 rounded-[10px] bg-brand-700 px-4 font-semibold text-white">Aç</PendingSubmit>
          </form>
        )}
        <p className="text-xs text-muted">Fişli cari, firmanın “(fişli)” ekiyle ayrı bir cari kartıdır; Cari kartlar listesinde de görünür. Faturalı ve fişli cariye aynı ödeme yazıldığı için iki bakiye ayrı ayrı okunur; birbirine eklenmez.</p>
      </div>
    </>
  );
}
