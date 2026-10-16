import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { poNo } from "@/lib/orders";
import { MATCH_STATUS, p3Error, type MatchRow, type Unlinked } from "@/lib/purchasing3";
import { linkInvoice, linkSuggested, saveMatchSettings } from "@/lib/purchasing3-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "3'lü eşleştirme" };

const TABS: [string, string][] = [["sorun", "Fark var"], ["bekleyen", "Fatura bekleniyor"], ["kismi", "Kısmi"], ["tamam", "Eşleşti"], ["hepsi", "Hepsi"]];
const TAB_MATCH: Record<string, string[]> = { sorun: ["diff"], bekleyen: ["waiting"], kismi: ["partial"], tamam: ["ok", "accepted"], hepsi: [] };

/** 3'lü eşleştirme: sipariş ↔ mal kabul ↔ alış faturası */
export default async function MatchPage({ searchParams }: { searchParams: Promise<{ s?: string; gun?: string }> }) {
  const s = await getSession();
  const lvl = Math.max(s.modules.purchases ?? 0, s.modules.finance ?? 0);
  if (lvl < 1) redirect("/");
  const sp = await searchParams;
  const days = [90, 180, 365].includes(Number(sp.gun)) ? Number(sp.gun) : 180;
  const sb = await createClient();
  const [{ data: ml, error }, { data: ul }, { data: st }] = await Promise.all([
    sb.rpc("pur_match_list", { p_days: days }),
    sb.rpc("pur_unlinked_invoices", { p_days: days }),
    sb.from("pur_settings").select("match_price_tol, match_qty_tol, budget_block").maybeSingle(),
  ]);
  const rows = (ml ?? []) as MatchRow[];
  const unl = (ul ?? []) as Unlinked[];
  const count = (k: string) => rows.filter((r) => TAB_MATCH[k].length === 0 || TAB_MATCH[k].includes(r.match)).length;
  const tab = sp.s && TAB_MATCH[sp.s] ? sp.s : count("sorun") > 0 ? "sorun" : "hepsi";
  const list = rows.filter((r) => TAB_MATCH[tab].length === 0 || TAB_MATCH[tab].includes(r.match));
  const diffSum = rows.filter((r) => r.match === "diff").reduce((a, r) => a + (r.currency === "TRY" ? r.diff : 0), 0);
  const cfg = (st ?? null) as { match_price_tol: number; match_qty_tol: number; budget_block: boolean } | null;
  const suggestions = unl.filter((u) => u.candidates[0] && !u.candidates[0].has_invoice && u.candidates[0].currency === u.currency && Math.abs(u.candidates[0].total - u.total) <= Math.max(100, u.total * 0.05));
  const q = (k: Record<string, string>) => `?${new URLSearchParams({ s: tab, gun: String(days), ...k })}`;

  return (
    <>
      <PageHeader title="3'lü eşleştirme" subtitle="Sipariş ↔ mal kabul ↔ alış faturası: miktar ve fiyat farkları ödeme öncesi yakalanır"
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href="/satinalma/raporlar" className="text-brand-700">Raporlar</Link><Link href="/satinalma" className="text-brand-700">← Satın alma</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1300px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{p3Error(error.message)}</p>}

        <section className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Tile label="Fark var" value={count("sorun")} sub={diffSum ? `TL siparişlerde fark ${money(diffSum, "TRY")}` : "Fazla faturalanan / fiyatı yüksek"} warn={count("sorun") > 0} href={q({ s: "sorun" })} />
          <Tile label="Fatura bekleniyor" value={count("bekleyen")} sub="Mal geldi ya da yolda, fatura yok" href={q({ s: "bekleyen" })} />
          <Tile label="Siparişe bağlanmamış fatura" value={unl.length} sub="Aşağıda önerilen siparişle bağlayın" warn={unl.length > 0} href="#baglanmamis" />
          <Tile label="Eşleşti" value={count("tamam")} sub="Ödemeye uygun" href={q({ s: "tamam" })} />
        </section>

        <div className="flex flex-wrap items-center gap-2">
          {TABS.map(([k, l]) => (
            <Link key={k} href={q({ s: k })} className={`h-9 px-3 inline-flex items-center gap-1.5 rounded-full text-sm font-semibold border ${tab === k ? "bg-brand-700 text-white border-brand-700" : "border-line text-brand-800 bg-white"}`}>
              {l}<span className={`text-xs ${tab === k ? "text-white/80" : "text-muted"}`}>{count(k)}</span>
            </Link>
          ))}
          <span className="ml-auto flex gap-1 text-xs">
            {[90, 180, 365].map((d) => <Link key={d} href={q({ gun: String(d) })} className={`px-2 py-1 rounded-md ${days === d ? "bg-[#EEF2F6] font-semibold" : "text-muted"}`}>Son {d} gün</Link>)}
          </span>
        </div>

        <section className="rounded-[16px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">Sipariş</th><th className="p-3">Tedarikçi</th><th className="p-3 text-right">Sipariş</th><th className="p-3 text-right">Teslim alınan</th><th className="p-3 text-right">Faturalanan</th><th className="p-3 text-right">Fark</th><th className="p-3 text-center">Fatura</th><th className="p-3">Durum</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.po_id} className="border-t border-[#EEF2F6] hover:bg-[#F8FAFC]">
                  <td className="p-3"><Link href={`/satinalma/eslestirme/${r.po_id}`} className="font-mono font-semibold text-brand-700">{poNo(r.year, r.no)}</Link><span className="block text-xs text-muted">{formatDate(r.order_date)}</span></td>
                  <td className="p-3">{r.party}</td>
                  <td className="p-3 text-right tabular-nums">{money(r.ordered, r.currency)}</td>
                  <td className="p-3 text-right tabular-nums">{money(r.received, r.currency)}</td>
                  <td className="p-3 text-right tabular-nums">{r.invoices ? money(r.invoiced, r.currency) : "—"}</td>
                  <td className={`p-3 text-right tabular-nums font-semibold ${r.invoices && r.diff > 100 ? "text-bad" : r.invoices && r.diff < -100 ? "text-brand-700" : "text-muted"}`}>{r.invoices ? `${r.diff > 0 ? "+" : ""}${money(r.diff, r.currency)}` : "—"}</td>
                  <td className="p-3 text-center">{r.invoices || "—"}</td>
                  <td className="p-3"><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${MATCH_STATUS[r.match]?.[1]}`}>{MATCH_STATUS[r.match]?.[0] ?? r.match}</span>{r.issues > 0 && r.match !== "accepted" && <span className="ml-1 text-xs text-bad">{r.issues} satır</span>}{r.ok_note && r.match === "accepted" && <span className="block text-xs text-muted truncate max-w-[220px]">{r.ok_note}</span>}</td>
                </tr>
              ))}
              {!list.length && !error && <tr><td colSpan={8} className="p-8 text-center text-muted">Bu filtrede sipariş yok.</td></tr>}
            </tbody>
          </table>
        </section>

        <section id="baglanmamis" className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display font-bold text-brand-800">Siparişe bağlanmamış alış faturaları</h2>
            <span className="text-xs text-muted">Aynı tedarikçinin siparişleri tutara yakınlığa göre önerilir. e-Fatura içe aktarılan ya da elle girilen faturalar burada eşleşir.</span>
          </div>
          {suggestions.length > 1 && (s.modules.purchases ?? 0) >= 2 && (
            <form action={linkSuggested} className="flex flex-wrap items-center gap-2 rounded-[12px] bg-[#F4F8FC] px-3 py-2 text-sm">
              {suggestions.map((u) => <input key={u.invoice_id} type="hidden" name="pair" value={`${u.invoice_id}:${u.candidates[0].id}`} />)}
              <span><b>{suggestions.length}</b> faturanın tutarı tek bir siparişle uyuşuyor (±%5).</span>
              <PendingSubmit className="h-9 px-3 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Hepsini önerilen siparişe bağla</PendingSubmit>
            </form>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead><tr className="text-left text-xs text-muted"><th className="p-2">Fatura</th><th className="p-2">Tedarikçi</th><th className="p-2 text-right">Tutar</th><th className="p-2">Bağlanacak sipariş</th></tr></thead>
              <tbody>
                {unl.map((u) => (
                  <tr key={u.invoice_id} className="border-t border-[#EEF2F6]">
                    <td className="p-2"><Link href={`/fatura/${u.invoice_id}`} className="font-semibold text-brand-700">{u.doc_no || "Taslak"}</Link><span className="block text-xs text-muted">{formatDate(u.invoice_date)}{u.status === "draft" ? " · taslak" : ""}</span></td>
                    <td className="p-2">{u.party}</td>
                    <td className="p-2 text-right tabular-nums">{money(u.total, u.currency)}</td>
                    <td className="p-2">
                      {(s.modules.purchases ?? 0) >= 2 ? (
                        <form action={linkInvoice} className="flex flex-wrap gap-1">
                          <input type="hidden" name="invoice_id" value={u.invoice_id} />
                          <select name="po_id" defaultValue={u.candidates[0]?.id} className="h-9 rounded-[10px] border border-[#D5DEE8] px-2 text-sm max-w-[360px]">
                            {u.candidates.map((c) => <option key={c.id} value={c.id}>{c.no} · {formatDate(c.date)} · {money(c.total, c.currency)}{c.has_invoice ? " · faturası var" : ""}</option>)}
                          </select>
                          <PendingSubmit className="h-9 px-3 rounded-[10px] border border-brand-600 text-brand-700 text-sm font-semibold">Bağla</PendingSubmit>
                        </form>
                      ) : <span className="text-xs text-muted">{u.candidates[0]?.no}</span>}
                    </td>
                  </tr>
                ))}
                {!unl.length && <tr><td colSpan={4} className="p-6 text-center text-muted">Bağlanmayı bekleyen fatura yok.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {(s.modules.purchases ?? 0) >= 3 && (
          <form action={saveMatchSettings} className="rounded-[16px] border border-line bg-white p-4 flex flex-wrap items-end gap-3 text-sm">
            <h2 className="w-full font-display font-bold text-brand-800">Kontrol ayarları</h2>
            <label className="flex flex-col gap-1">Fiyat toleransı (%)<input name="price_tol" defaultValue={String(Number(cfg?.match_price_tol ?? 2)).replace(".", ",")} inputMode="decimal" className="h-10 w-28 rounded-[10px] border border-[#D5DEE8] px-2" /></label>
            <label className="flex flex-col gap-1">Miktar toleransı<input name="qty_tol" defaultValue={String(Number(cfg?.match_qty_tol ?? 0)).replace(".", ",")} inputMode="decimal" className="h-10 w-28 rounded-[10px] border border-[#D5DEE8] px-2" /></label>
            <label className="flex items-center gap-2 h-10"><input type="checkbox" name="budget_block" defaultChecked={cfg?.budget_block ?? true} /> Bütçeyi aşan sipariş yönetici onayına düşsün</label>
            <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Kaydet</PendingSubmit>
            <span className="w-full text-xs text-muted">Fatura birim fiyatı sipariş fiyatını toleranstan fazla aşarsa ya da faturalanan miktar teslim alınandan fazlaysa &quot;fark var&quot; olur. Hizmet ve stok kartı olmayan satırlar mal kabule girmediği için sipariş miktarıyla karşılaştırılır.</span>
          </form>
        )}
      </div>
    </>
  );
}

function Tile({ label, value, sub, warn, href }: { label: string; value: number; sub: string; warn?: boolean; href: string }) {
  return (
    <Link href={href} className={`rounded-[16px] border bg-white p-4 flex flex-col gap-1 hover:border-brand-600 ${warn ? "border-warn" : "border-line"}`}>
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className={`font-display text-3xl font-bold ${warn && value > 0 ? "text-bad" : ""}`}>{value}</span>
      <span className="text-[11px] text-muted">{sub}</span>
    </Link>
  );
}
