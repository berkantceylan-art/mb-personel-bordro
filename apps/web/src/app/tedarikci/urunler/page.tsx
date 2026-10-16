import { money } from "@/lib/jobs";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { NotLinked, PortalShell } from "@/components/supplier/PortalShell";
import { submitPriceList } from "@/lib/supplier-portal-actions";
import { PRICE_STATUS, dmy, portalCtx, portalError, portalHome, type PriceList, type Product } from "@/lib/supplier-portal";

export const dynamic = "force-dynamic";

/** Ürünlerim (daha önce bizden aldığımız ürünler, son fiyat) + yeni fiyat listesi gönder + geçmiş listeler */
export default async function SupplierProducts({ searchParams }: { searchParams: Promise<{ cari?: string }> }) {
  const ctx = await portalCtx(await searchParams, "/tedarikci/urunler");
  if (!ctx) return <NotLinked />;
  const { badges } = await portalHome(ctx);
  const [{ data: ps, error }, { data: ls }] = await Promise.all([
    ctx.sb.rpc("sup_products", { p_party: ctx.party.id }),
    ctx.sb.from("sup_price_lists").select("id, title, currency, valid_from, status, note, submitted_at, sender_name, decision_note, doc_id").eq("party_id", ctx.party.id).order("submitted_at", { ascending: false }).limit(20),
  ]);
  const products = (ps ?? []) as Product[];
  const lists = (ls ?? []) as PriceList[];
  const ids = lists.map((l) => l.id);
  const { data: ln } = ids.length ? await ctx.sb.from("sup_price_lines").select("list_id, name, unit, old_price, new_price, approved").in("list_id", ids).order("sort") : { data: [] };
  const lines = (ln ?? []) as { list_id: string; name: string; unit: string; old_price: number | null; new_price: number; approved: boolean | null }[];
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const lastCur = products.find((p) => p.currency)?.currency ?? "TRY";

  return (
    <PortalShell ctx={ctx} active="/tedarikci/urunler" badges={badges}>
      <div><h2 className="font-display text-2xl font-bold text-brand-800">Ürünler ve fiyat listesi</h2><p className="text-sm text-muted">Bizim sizden aldığımız ürünler otomatik listelenir. Yeni fiyatlarınızı yazıp gönderin; satın alma onaylayınca siparişlerde bu fiyat kullanılır.</p></div>
      {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{portalError(error.message)}</p>}

      <form action={submitPriceList} className="rounded-[20px] border border-line bg-white flex flex-col">
        <input type="hidden" name="party_id" value={ctx.party.id} />
        <div className="p-4 md:p-5 grid gap-3 md:grid-cols-4 text-sm border-b border-line bg-[#F7F9FB] rounded-t-[20px]">
          <label className="flex flex-col gap-1 md:col-span-2">Liste adı<input name="title" placeholder={`Fiyat listesi ${dmy(today)}`} maxLength={160} className="h-10 rounded-[10px] border border-[#D5DEE8] px-3 bg-white" /></label>
          <label className="flex flex-col gap-1">Para birimi<select name="currency" defaultValue={lastCur} className="h-10 rounded-[10px] border border-[#D5DEE8] px-2 bg-white">{["TRY", "EUR", "USD", "GBP", "CHF"].map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="flex flex-col gap-1">Geçerlilik başlangıcı<input type="date" name="valid_from" defaultValue={today} className="h-10 rounded-[10px] border border-[#D5DEE8] px-3 bg-white" /></label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">Ürün</th><th className="p-3">Birim</th><th className="p-3 text-right">Son alış fiyatımız</th><th className="p-3">Son alış</th><th className="p-3 text-right">12 ay miktar</th><th className="p-3 w-40">Yeni fiyatınız (KDV hariç)</th></tr></thead>
            <tbody>
              {products.map((p, i) => (
                <tr key={p.key} className="border-t border-[#EEF2F6]">
                  <td className="p-3"><span className="font-semibold">{p.name}</span>{p.code && <span className="ml-2 text-xs text-muted font-mono">{p.code}</span>}</td>
                  <td className="p-3">{p.unit}</td>
                  <td className="p-3 text-right tabular-nums">{p.last_price != null ? money(p.last_price, p.currency ?? "TRY") : p.current_price != null ? money(p.current_price, p.current_currency ?? "TRY") : "—"}</td>
                  <td className="p-3 text-xs text-muted">{p.last_date ? `${dmy(p.last_date)} · ${p.times} kez` : "Kartta kayıtlı"}</td>
                  <td className="p-3 text-right">{Number(p.qty_12m) ? Number(p.qty_12m).toLocaleString("tr-TR") : "—"}</td>
                  <td className="p-3">
                    <input type="hidden" name={`meta_${i}`} value={JSON.stringify({ item_id: p.item_id, code: p.code, name: p.name, unit: p.unit, old_price: p.last_price ?? p.current_price, old_currency: p.currency ?? p.current_currency })} />
                    <input name={`p_${i}`} inputMode="decimal" placeholder="0,00" className="h-10 w-full rounded-[10px] border border-[#D5DEE8] px-3 text-right tabular-nums focus:border-brand-600 focus:outline-none" />
                  </td>
                </tr>
              ))}
              {!products.length && <tr><td colSpan={6} className="p-6 text-center text-muted">Henüz sizden ürün almamışız. Aşağıya yeni ürünlerinizi ekleyebilirsiniz.</td></tr>}
              <tr className="border-t-2 border-line bg-[#F7F9FB]"><td colSpan={6} className="px-3 py-2 text-xs font-semibold text-muted">YENİ ÜRÜN ÖNERİN</td></tr>
              {[0, 1, 2].map((i) => (
                <tr key={`n${i}`} className="border-t border-[#EEF2F6]">
                  <td className="p-2" colSpan={2}><input name={`new_name_${i}`} placeholder="Ürün adı" className="h-10 w-full rounded-[10px] border border-[#D5DEE8] px-3" /></td>
                  <td className="p-2"><input name={`new_code_${i}`} placeholder="Kod" className="h-10 w-full rounded-[10px] border border-[#D5DEE8] px-3" /></td>
                  <td className="p-2" colSpan={2}><input name={`new_unit_${i}`} placeholder="Birim (adet, kutu…)" className="h-10 w-full rounded-[10px] border border-[#D5DEE8] px-3" /></td>
                  <td className="p-2"><input name={`new_price_${i}`} inputMode="decimal" placeholder="0,00" className="h-10 w-full rounded-[10px] border border-[#D5DEE8] px-3 text-right" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 md:p-5 border-t border-line flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1 flex-1 min-w-[240px]">Not<input name="note" maxLength={1000} placeholder="ör. Kasım'dan itibaren hammadde zammı nedeniyle" className="h-10 rounded-[10px] border border-[#D5DEE8] px-3" /></label>
          <label className="flex flex-col gap-1">Liste dosyası (isteğe bağlı)<input type="file" name="file" className="text-xs" /></label>
          <PendingSubmit className="h-11 px-6 rounded-xl bg-brand-700 text-white font-semibold">Fiyat listesini gönder</PendingSubmit>
        </div>
      </form>

      <section className="rounded-[20px] border border-line bg-white p-4 md:p-5">
        <h3 className="font-display font-bold text-brand-800 mb-3">Gönderdiğiniz listeler</h3>
        <div className="flex flex-col gap-2">
          {lists.map((l) => {
            const ll = lines.filter((x) => x.list_id === l.id);
            return (
              <details key={l.id} className="rounded-xl border border-[#EEF2F6] px-3 py-2">
                <summary className="flex flex-wrap items-center gap-2 cursor-pointer text-sm">
                  <b>{l.title}</b><span className="text-muted">{dmy(l.submitted_at)} · {ll.length} kalem · {l.currency} · geçerli {dmy(l.valid_from)}</span>
                  <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-semibold ${PRICE_STATUS[l.status]?.[1]}`}>{PRICE_STATUS[l.status]?.[0]}</span>
                </summary>
                {l.decision_note && <p className="text-sm mt-2"><b>Satın alma notu:</b> {l.decision_note}</p>}
                <table className="w-full text-sm mt-2">
                  <tbody>{ll.map((x, i) => {
                    const ch = x.old_price ? Math.round(((x.new_price - x.old_price) / x.old_price) * 1000) / 10 : null;
                    return (
                      <tr key={i} className="border-t border-[#EEF2F6]">
                        <td className="py-1.5">{x.name}</td><td className="py-1.5 text-right tabular-nums text-muted">{x.old_price != null ? money(x.old_price, l.currency) : "yeni"}</td>
                        <td className="py-1.5 text-right tabular-nums font-semibold">{money(x.new_price, l.currency)}</td>
                        <td className={`py-1.5 text-right text-xs ${ch && ch > 0 ? "text-bad" : "text-ok"}`}>{ch != null && ch !== 0 ? `${ch > 0 ? "+" : ""}%${ch}` : ""}</td>
                        <td className="py-1.5 text-right text-xs">{x.approved == null ? "" : x.approved ? "✓ onaylandı" : "✗"}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </details>
            );
          })}
          {!lists.length && <p className="text-sm text-muted">Henüz liste göndermediniz.</p>}
        </div>
      </section>
    </PortalShell>
  );
}
