import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/fetch-all";
import { FLAG_LABEL, billable, flagItems, loadCarrierItems, loadCarrierShipments, type Flag } from "@/lib/carrier-check";
import { CarrierTools } from "./CarrierTools";

const tl = (k: number) => `${(k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
const day = (d: string | null) => (d ? d.split("-").reverse().join(".") : "—");
type Inv = { id: string; carrier: string; invoice_no: string; invoice_date: string | null; due_date: string | null; bill_type: string | null; total: number; detail_total: number; shipments: number; status: string; source: string };

export type CarrierSp = { uyari?: string; ay?: string; rapor?: string };
const NAME = { dhl: "DHL", ups: "UPS" } as const;

/** Tek kargo firmasının faturaları: konşimento eşleştirme, mükerrer / fazla fatura kontrolü */
export async function CarrierView({ carrier, sp }: { carrier: "dhl" | "ups"; sp: CarrierSp }) {
  const other = carrier === "dhl" ? "ups" : "dhl";
  const months = Math.min(24, Math.max(1, Number(sp.ay) || 6));
  const from = new Date(Date.now() - months * 31 * 86400000).toISOString().slice(0, 10);
  const sb = await createClient();
  const { data: invs, error } = await sb.from("carrier_invoices").select("id, carrier, invoice_no, invoice_date, due_date, bill_type, total, detail_total, shipments, status, source").eq("carrier", carrier).or(`invoice_date.gte.${from},invoice_date.is.null`).order("invoice_date", { ascending: false }).limit(500);
  if (error) {
    return (<><PageHeader title={`${NAME[carrier]} faturaları`} /><div className="p-4 md:p-8"><p className="rounded-[12px] bg-warn-bg text-warn px-4 py-3 text-sm">{/carrier_/.test(error.message) ? "Önce mbdental-kargo-fatura.sql dosyasını Supabase'de çalıştırın." : error.message}</p></div></>);
  }
  const list = (invs ?? []) as Inv[];
  const items = await flagItems((await loadCarrierItems(from, undefined, carrier)).data);
  const awbSet = new Set(items.map((i) => i.awb));
  // faturası gelmemiş: 30–180 gün önce açılmış giden DHL / UPS gönderileri
  const { data: ships } = await allRows<{ id: string; no: number; carrier: string; tracking_no: string; party_name: string | null; created_at: string }>((a, b) =>
    sb.from("shipments").select("id, no, carrier, tracking_no, party_name, created_at").eq("carrier", carrier).eq("direction", "out").not("tracking_no", "is", null)
      .lte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()).gte("created_at", new Date(Date.now() - 180 * 86400000).toISOString()).order("id").range(a, b));
  const noInvoice = ships.filter((x) => !awbSet.has(x.tracking_no.replace(/\s+/g, "").toUpperCase()));

  // Konşimento raporu (DHL Gönderi Detay Raporu) ↔ fatura satırları
  const repRes = await loadCarrierShipments(from, carrier).catch((e) => ({ data: [] as Awaited<ReturnType<typeof loadCarrierShipments>>["data"], error: { message: String(e) } }));
  const rep = repRes.data;
  const repMissing = !!repRes.error && /carrier_shipments|schema cache|does not exist/i.test(repRes.error.message);
  const repActive = rep.filter((r) => !/iptal/i.test(r.status ?? ""));
  const repSet = new Set(rep.map((r) => `${r.carrier}|${r.awb}`));
  const itemBy = new Map(items.map((i) => [`${i.carrier_invoices?.carrier}|${i.awb}`, i]));
  const repDates = repActive.map((r) => r.ship_date ?? "").filter(Boolean).sort();
  const lag = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
  const eur = (i: (typeof items)[number]) => (i.carrier_invoices?.eur_rate ? Math.round(i.total / Number(i.carrier_invoices.eur_rate)) : null);
  const R = {
    faturasiz: repActive.filter((r) => !itemBy.has(`${r.carrier}|${r.awb}`) && (r.ship_date ?? "") <= lag),
    yok: items.filter((i) => repDates.length && (i.ship_date ?? "") >= repDates[0]! && (i.ship_date ?? "") <= repDates[repDates.length - 1]! && !repSet.has(`${carrier}|${i.awb}`)),
    fark: repActive.filter((r) => { const i = itemBy.get(`${r.carrier}|${r.awb}`); const e = i ? eur(i) : null; return i && e != null && r.est_amount && r.est_currency === "EUR" && e - r.est_amount > Math.max(200, r.est_amount * 0.1); }),
    agirlik: repActive.filter((r) => { const i = itemBy.get(`${r.carrier}|${r.awb}`); const b = billable(r.weight, r.vol_weight); return i && i.weight && b && i.weight > b + 0.001; }),
    saat: repActive.filter((r) => carrier === "dhl" ? /12:00|09:00|9:00|10:30/.test(r.service ?? "") : /^UPS Express( Plus)?$|Early/i.test(r.service ?? "")),
  };
  const RL: Record<keyof typeof R, string> = { faturasiz: "Faturası gelmemiş konşimento", yok: "Faturada var, raporda yok", fark: "Fatura tahmini ücretten %10+ fazla", agirlik: "Beyandan ağır faturalanmış", saat: carrier === "dhl" ? "Express 12:00 seçilmiş" : "UPS Express (Saver değil)" };
  const rsel = (Object.keys(R) as (keyof typeof R)[]).includes(sp.rapor as keyof typeof R) ? (sp.rapor as keyof typeof R) : null;
  const flagCount = (f: Flag) => items.filter((i) => i.flags.includes(f)).length;
  const sel = (Object.keys(FLAG_LABEL) as Flag[]).includes(sp.uyari as Flag) ? (sp.uyari as Flag) : null;
  const shown = sel ? items.filter((i) => i.flags.includes(sel)) : [];
  const extras = items.reduce((a, i) => a + i.extras_total, 0);
  const base = items.reduce((a, i) => a + i.base_amount, 0);
  const byCust = new Map<string, { name: string; n: number; t: number }>();
  for (const i of items) { const k = i.customer_id ?? "-"; const g = byCust.get(k) ?? { name: i.lab_customers?.name ?? "Hekim bulunamadı", n: 0, t: 0 }; g.n++; g.t += i.total; byCust.set(k, g); }
  const extraNames = new Map<string, number>();
  for (const i of items) for (const x of i.extras) { const k = x.name.toLocaleUpperCase("tr").replace(/\s+/g, " ").trim(); extraNames.set(k, (extraNames.get(k) ?? 0) + x.amount); }
  const disputed = items.filter((i) => i.disputed);
  const th = "py-2 px-2 font-semibold text-left text-xs text-muted";
  const td = "py-2 px-2 border-t border-[#EEF2F6]";

  return (
    <>
      <PageHeader title={`${NAME[carrier]} faturaları`} subtitle="Konşimento bazında: mükerrer, fazla ve beklenmeyen ücret kontrolü" actions={<span className="flex gap-4 text-sm font-semibold"><Link href={`/kargo/faturalar/${other}`} className="text-brand-700">{NAME[other]} faturaları →</Link><Link href="/kargo" className="text-brand-700">← Kargo</Link></span>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        <CarrierTools carrier={carrier} />
        <section className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[[`${NAME[carrier]} faturaları`, tl(list.reduce((a, i) => a + i.total, 0)), `${list.length} fatura`],
            ["Gönderi", String(items.length), items.length ? `ortalama ${tl(items.reduce((a, i) => a + i.total, 0) / items.length)}` : ""],
            ["Ek ücretler", tl(extras), base ? `taşıma bedelinin %${Math.round((extras / base) * 100)}'i` : ""],
            ["İtiraz edilecek", String(disputed.length), disputed.length ? tl(disputed.reduce((a, i) => a + i.total, 0)) : "işaretli satır yok"]].map(([l, v, sub]) => (
            <div key={l} className="rounded-[14px] border border-line bg-white p-4"><p className="text-xs text-muted font-semibold">{l} · son {months} ay</p><p className="text-xl font-bold num mt-1">{v}</p><p className="text-xs text-muted mt-0.5">{sub}</p></div>
          ))}
        </section>

        <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
          <h2 className="font-display text-lg font-bold">Kontrol</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            {(Object.keys(FLAG_LABEL) as Flag[]).map((f) => (
              <Link key={f} href={`?uyari=${f}&ay=${months}`} className={`rounded-full border px-3 py-1.5 font-semibold ${sel === f ? "bg-brand-700 text-white border-brand-700" : flagCount(f) ? "border-[#F2D58A] bg-warn-bg text-warn" : "border-line text-muted"}`}>{FLAG_LABEL[f]} · {flagCount(f)}</Link>
            ))}
            <span className={`rounded-full border px-3 py-1.5 font-semibold ${noInvoice.length ? "border-[#F2D58A] bg-warn-bg text-warn" : "border-line text-muted"}`}>Faturası gelmemiş (30+ gün) · {noInvoice.length}</span>
            {sel && <Link href={`?ay=${months}`} className="px-2 py-1.5 text-brand-700 font-semibold">Temizle</Link>}
            <a href={`/kargo/faturalar/excel?ay=${months}&firma=${carrier}`} className="ml-auto px-2 py-1.5 text-brand-700 font-semibold">İtiraz / uyarı listesi (Excel)</a>
          </div>
          {sel && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead><tr><th className={th}>Tarih</th><th className={th}>Konşimento</th><th className={th}>Fatura</th><th className={th}>Alıcı / hekim</th><th className={th}>Varış</th><th className={`${th} text-right`}>Kg</th><th className={`${th} text-right`}>Ek ücret</th><th className={`${th} text-right`}>Toplam</th><th className={th}>Uyarı</th></tr></thead>
                <tbody>
                  {shown.slice(0, 300).map((i) => (
                    <tr key={i.id} className={i.disputed ? "bg-[#FFF6F5]" : ""}>
                      <td className={td}>{day(i.ship_date)}</td>
                      <td className={`${td} font-mono text-xs`}>{i.awb}</td>
                      <td className={td}><Link href={`/kargo/faturalar/${i.invoice_id}`} className="text-brand-700 font-semibold">{i.carrier_invoices?.invoice_no}</Link></td>
                      <td className={td}>{i.lab_customers?.name ?? <span className="text-muted">{i.recipient_company ?? i.recipient ?? "—"}</span>}</td>
                      <td className={td}>{i.dest_country ?? i.dest ?? "—"}</td>
                      <td className={`${td} text-right num`}>{i.weight ?? "—"}{i.weight_basis ? <span className="text-xs text-muted"> {i.weight_basis}</span> : null}</td>
                      <td className={`${td} text-right num`}>{tl(i.extras_total)}</td>
                      <td className={`${td} text-right num font-semibold`}>{tl(i.total)}</td>
                      <td className={`${td} text-xs`}>{i.flags.map((f) => FLAG_LABEL[f]).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!sel && noInvoice.length > 0 && (
            <details className="text-sm"><summary className="cursor-pointer font-semibold">Faturası gelmemiş gönderiler — kargo modülü ({noInvoice.length})</summary>
              <ul className="grid gap-0.5 mt-2 text-xs">{noInvoice.slice(0, 100).map((x) => <li key={x.id}><Link href={`/kargo/${x.id}`} className="text-brand-700">#{x.no}</Link> · {x.tracking_no} · {x.party_name ?? ""} · {day(x.created_at.slice(0, 10))}</li>)}</ul>
            </details>
          )}
          <p className="text-xs text-muted">Kg yanındaki harf (DHL): A / V sizin tartı / hacim beyanınız, B / W DHL&apos;in tartısı / hacim ölçümü. &quot;Ortalamanın üstünde&quot;: aynı taşıyıcı ve ülkede kg başı ücret, ortancanın %30 üstünde.</p>
        </section>

        <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
          <h2 className="font-display text-lg font-bold">Konşimento raporu ↔ faturalar</h2>
          {repMissing ? (
            <p className="rounded-[12px] bg-warn-bg text-warn px-4 py-3 text-sm">Konşimento listesi için önce <b>mbdental-kargo-konsimento.sql</b> dosyası Supabase&apos;de çalıştırılmalı; sonra listeyi tekrar yükleyin.</p>
          ) : rep.length === 0 ? (
            <p className="text-sm text-muted">{carrier === "dhl" ? <>MyDHL+ › Raporlar › <b>Gönderi Detay Raporu</b>&apos;nu CSV olarak indirip yukarıdan yükleyin; oluşturduğunuz konşimentolar faturalarla karşılaştırılır.</> : <>ups.com › <b>UPS My Choice for Business / gönderilerim</b> listesini CSV olarak indirip yukarıdan yükleyin; gönderdiğiniz paketler faturalarla karşılaştırılır.</>}</p>
          ) : (
            <>
              <p className="text-sm text-muted">Raporda {repActive.length} konşimento ({repActive.filter((r) => r.direction === "export").length} ihracat · {repActive.filter((r) => r.direction === "import").length} ithalat){repDates.length ? ` · ${day(repDates[0]!)} – ${day(repDates[repDates.length - 1]!)}` : ""} · faturalanmış {repActive.filter((r) => itemBy.has(`${r.carrier}|${r.awb}`)).length}</p>
              <div className="flex flex-wrap gap-2 text-sm">
                {(Object.keys(R) as (keyof typeof R)[]).map((k) => (
                  <Link key={k} href={`?rapor=${k}&ay=${months}`} className={`rounded-full border px-3 py-1.5 font-semibold ${rsel === k ? "bg-brand-700 text-white border-brand-700" : R[k].length ? "border-[#F2D58A] bg-warn-bg text-warn" : "border-line text-muted"}`}>{RL[k]} · {R[k].length}</Link>
                ))}
                {rsel && <Link href={`?ay=${months}`} className="px-2 py-1.5 text-brand-700 font-semibold">Temizle</Link>}
              </div>
              {rsel === "yok" && (
                <table className="w-full text-sm"><tbody>{R.yok.map((i) => <tr key={i.id}><td className={td}>{day(i.ship_date)}</td><td className={`${td} font-mono text-xs`}>{i.awb}</td><td className={td}><Link href={`/kargo/faturalar/${i.invoice_id}`} className="text-brand-700">{i.carrier_invoices?.invoice_no}</Link></td><td className={td}>{i.recipient_company ?? i.recipient}</td><td className={`${td} text-right num font-semibold`}>{tl(i.total)}</td></tr>)}</tbody></table>
              )}
              {rsel && rsel !== "yok" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[980px]">
                    <thead><tr><th className={th}>Tarih</th><th className={th}>Konşimento</th><th className={th}>Yön</th><th className={th}>Karşı taraf / hekim</th><th className={th}>Hizmet</th><th className={`${th} text-right`}>Beyan kg / hacim</th><th className={`${th} text-right`}>Faturalanan kg</th><th className={`${th} text-right`}>Tahmini</th><th className={`${th} text-right`}>Fatura</th><th className={th}>Durum</th></tr></thead>
                    <tbody>
                      {(R[rsel] as typeof repActive).slice(0, 400).map((r) => {
                        const i = itemBy.get(`${r.carrier}|${r.awb}`);
                        const e = i ? eur(i) : null;
                        return (
                          <tr key={r.id}>
                            <td className={td}>{day(r.ship_date)}</td>
                            <td className={`${td} font-mono text-xs`}>{r.awb}</td>
                            <td className={td}>{r.direction === "import" ? "İthalat" : r.direction === "export" ? "İhracat" : "Yurt içi"}</td>
                            <td className={td}>{r.lab_customers?.name ? <b>{r.lab_customers.name}</b> : r.party_company}{r.party_country ? <span className="text-xs text-muted"> · {r.party_country}</span> : null}</td>
                            <td className={`${td} text-xs`}>{r.service ?? "—"}</td>
                            <td className={`${td} text-right num`}>{r.weight ?? "—"} / {r.vol_weight ?? "—"}</td>
                            <td className={`${td} text-right num`}>{i?.weight ?? "—"}{i?.weight_basis ? <span className="text-xs text-muted"> {i.weight_basis}</span> : null}</td>
                            <td className={`${td} text-right num`}>{r.est_amount ? `${(r.est_amount / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${r.est_currency === "EUR" ? "€" : r.est_currency ?? ""}` : "—"}</td>
                            <td className={`${td} text-right num font-semibold`}>{i ? <Link href={`/kargo/faturalar/${i.invoice_id}`} className="text-brand-700">{tl(i.total)}</Link> : "—"}{e != null && <span className="block text-xs text-muted">≈ {(e / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} €</span>}</td>
                            <td className={`${td} text-xs`}>{r.status ?? ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-muted">{carrier === "dhl" ? "İthalat konşimentoları MB IMPORT hesabına (alıcı ödemeli) ayrı faturayla gelir. " : ""}Faturalanan kg: büyük olan ağırlık (gerçek / hacim) 0,5 kg&apos;a yukarı yuvarlanır; bunun üstü &quot;beyandan ağır&quot; sayılır.</p>
            </>
          )}
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-[16px] border border-line bg-white p-4">
            <h2 className="font-display text-lg font-bold mb-2">Hekim bazında kargo maliyeti</h2>
            <table className="w-full text-sm"><tbody>
              {[...byCust.values()].sort((a, b) => b.t - a.t).slice(0, 15).map((g) => <tr key={g.name}><td className={td}>{g.name}</td><td className={`${td} text-right num`}>{g.n}</td><td className={`${td} text-right num font-semibold`}>{tl(g.t)}</td></tr>)}
            </tbody></table>
          </section>
          <section className="rounded-[16px] border border-line bg-white p-4">
            <h2 className="font-display text-lg font-bold mb-2">Ek ücret dökümü</h2>
            <table className="w-full text-sm"><tbody>
              {[...extraNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, t]) => <tr key={n}><td className={td}>{n}</td><td className={`${td} text-right num font-semibold`}>{tl(t)}</td></tr>)}
            </tbody></table>
          </section>
        </div>

        <section className="rounded-[16px] border border-line bg-white p-4 overflow-x-auto">
          <h2 className="font-display text-lg font-bold mb-2">Faturalar</h2>
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr><th className={th}>Tarih</th><th className={th}>Fatura no</th><th className={th}>Tür</th><th className={`${th} text-right`}>Gönderi</th><th className={`${th} text-right`}>Tutar</th><th className={th}>Durum</th></tr></thead>
            <tbody>
              {list.map((i) => {
                const diff = i.shipments > 0 && Math.abs(i.total - i.detail_total) > 100;
                return (
                  <tr key={i.id}>
                    <td className={td}>{day(i.invoice_date)}</td>
                                        <td className={td}><Link href={`/kargo/faturalar/${i.id}`} className="text-brand-700 font-semibold">{i.invoice_no}</Link></td>
                    <td className={`${td} text-xs`}>{i.bill_type ?? "—"}</td>
                    <td className={`${td} text-right num`}>{i.shipments || <span className="text-warn text-xs">ayrıntı yok</span>}</td>
                    <td className={`${td} text-right num font-semibold`}>{tl(i.total)}{diff && <span className="block text-xs text-bad">satırlar: {tl(i.detail_total)}</span>}</td>
                    <td className={`${td} text-xs`}>{i.status === "checked" ? "✓ kontrol edildi" : i.status === "disputed" ? "⚠ itiraz" : "açık"}</td>
                  </tr>
                );
              })}
              {list.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">Henüz fatura yok. Yukarıdan dosya yükleyin ya da e-postadan çekin.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
