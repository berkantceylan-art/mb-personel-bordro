import "server-only";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/fetch-all";
import { FLAG_LABEL, PREMIUM, billable, flagItems, loadCarrierItems, loadCarrierShipments, type CShip, type Flag } from "@/lib/carrier-check";

export const CARRIER_NAME = { dhl: "DHL", ups: "UPS" } as const;
export type RKey = "faturasiz" | "yok" | "fark" | "agirlik" | "saat";

/** Bir kargo firmasının fatura satırları + konşimento raporu karşılaştırması (sayfa, Excel ve itiraz e-postası aynı hesabı kullanır) */
export async function carrierReport(carrier: "dhl" | "ups", months: number) {
  const from = new Date(Date.now() - months * 31 * 86400000).toISOString().slice(0, 10);
  const sb = await createClient();
  const items = await flagItems((await loadCarrierItems(from, undefined, carrier)).data);
  const awbSet = new Set(items.map((i) => i.awb));
  const { data: ships } = await allRows<{ id: string; no: number; carrier: string; tracking_no: string; party_name: string | null; created_at: string }>((a, b) =>
    sb.from("shipments").select("id, no, carrier, tracking_no, party_name, created_at").eq("carrier", carrier).eq("direction", "out").not("tracking_no", "is", null)
      .lte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()).gte("created_at", new Date(Date.now() - 180 * 86400000).toISOString()).order("id").range(a, b));
  const noInvoice = ships.filter((x) => !awbSet.has(x.tracking_no.replace(/\s+/g, "").toUpperCase()));

  const repRes = await loadCarrierShipments(from, carrier).catch((e) => ({ data: [] as CShip[], error: { message: String(e) } }));
  const rep = repRes.data;
  const repMissing = !!repRes.error && /carrier_shipments|schema cache|does not exist/i.test(repRes.error.message);
  const repActive = rep.filter((r) => !/iptal/i.test(r.status ?? ""));
  const repSet = new Set(rep.map((r) => `${r.carrier}|${r.awb}`));
  const itemBy = new Map(items.map((i) => [`${i.carrier_invoices?.carrier}|${i.awb}`, i]));
  const repBy = new Map(rep.map((r) => [`${r.carrier}|${r.awb}`, r]));
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
  const RL: Record<RKey, string> = { faturasiz: "Faturası gelmemiş konşimento", yok: "Faturada var, raporda yok", fark: "Fatura tahmini ücretten %10+ fazla", agirlik: "Beyandan ağır faturalanmış", saat: carrier === "dhl" ? "Express 12:00 seçilmiş" : "UPS Express (Saver değil)" };
  return { from, items, noInvoice, rep, repActive, repMissing, repDates, itemBy, repBy, R, RL, eur };
}
export type CarrierReport = Awaited<ReturnType<typeof carrierReport>>;

const day = (d: string | null | undefined) => (d ? d.split("-").reverse().join(".") : "");
const tl2 = (k: number) => Math.round(k) / 100;
const extrasText = (x: { name: string; amount: number }[]) => x.map((e) => `${e.name}: ${(e.amount / 100).toFixed(2)}`).join(" | ");

/** Beyandan ağır satırları (e-posta ve Excel ortak) */
export function heavyRows(d: CarrierReport) {
  return d.R.agirlik.map((r) => {
    const i = d.itemBy.get(`${r.carrier}|${r.awb}`)!;
    const b = billable(r.weight, r.vol_weight)!;
    const w = i.weight ?? 0;
    return { r, i, declared: b, billed: w, diff: Math.round((w - b) * 10) / 10, approx: w > 0 ? Math.round(i.base_amount * (1 - b / w)) : 0 };
  }).sort((a, b) => b.diff - a.diff);
}

/**
 * Excel: kapsam "tum" tüm kontroller (iç kullanım), "itiraz" yalnız kargo firmasına gönderilecek sayfalar.
 */
export function carrierWorkbook(d: CarrierReport, carrier: "dhl" | "ups", kapsam: "tum" | "itiraz" = "tum"): Buffer {
  const N = CARRIER_NAME[carrier];
  const inv = (i: (typeof d.items)[number]) => ({ "Fatura no": i.carrier_invoices?.invoice_no ?? "", "Fatura tarihi": day(i.carrier_invoices?.invoice_date) });
  const itemRow = (i: (typeof d.items)[number], internal: boolean) => ({
    ...inv(i), "Gönderi tarihi": day(i.ship_date), "Konşimento (takip no)": i.awb, "Alıcı": i.recipient_company ?? i.recipient ?? "",
    ...(internal ? { "Hekim": i.lab_customers?.name ?? "" } : {}), "Ülke": i.dest_country ?? i.dest ?? "", "Hizmet": i.product ?? "",
    "Faturalanan kg": i.weight ?? "", "Taşıma (TL)": tl2(i.base_amount), "Ek ücretler (TL)": tl2(i.extras_total), "Ek ücret ayrıntısı": extrasText(i.extras), "Toplam (TL)": tl2(i.total),
    ...(internal ? { "Uyarılar": i.flags.map((f) => FLAG_LABEL[f]).join(", "), "İtiraz": i.disputed ? "Evet" : "", "Not": i.note ?? "" } : {}),
  });
  const internal = kapsam === "tum";
  const heavy = heavyRows(d).map((h) => ({
    ...inv(h.i), "Gönderi tarihi": day(h.r.ship_date ?? h.i.ship_date), "Konşimento (takip no)": h.r.awb, "Alıcı": h.r.party_company ?? h.i.recipient_company ?? h.i.recipient ?? "",
    ...(internal ? { "Hekim": h.r.lab_customers?.name ?? h.i.lab_customers?.name ?? "" } : {}), "Ülke": h.r.party_country ?? h.i.dest_country ?? "", "Hizmet": h.r.service ?? h.i.product ?? "",
    "Beyan edilen kg": h.r.weight ?? "", "Beyan hacim kg": h.r.vol_weight ?? "", "Beyana göre faturalanması gereken kg": h.declared, "Faturalanan kg": h.billed, "Fark kg": h.diff,
    "Taşıma (TL)": tl2(h.i.base_amount), "Ek ücretler (TL)": tl2(h.i.extras_total), "Toplam (TL)": tl2(h.i.total),
    ...(internal ? { "Yaklaşık fazla taşıma (TL, orantılı)": tl2(h.approx) } : {}),
  }));
  const pick = (f: Flag) => d.items.filter((i) => i.flags.includes(f)).map((i) => itemRow(i, internal));
  const premium = d.items.filter((i) => i.flags.includes("premium")).map((i) => ({ ...itemRow(i, internal), "Sorgulanan ek hizmet": i.extras.filter((x) => PREMIUM.test(x.name)).map((x) => `${x.name}: ${(x.amount / 100).toFixed(2)} TL`).join(" | ") }));
  const dup = d.items.filter((i) => i.flags.includes("dup")).sort((a, b) => a.awb.localeCompare(b.awb)).map((i) => itemRow(i, internal));
  const fark = d.R.fark.map((r) => { const i = d.itemBy.get(`${r.carrier}|${r.awb}`)!; const e = d.eur(i); return { ...itemRow(i, internal), "Tahmini ücret (EUR)": (r.est_amount ?? 0) / 100, "Fatura (EUR, kurla)": e != null ? e / 100 : "" }; });
  const yok = d.R.yok.map((i) => itemRow(i, internal));
  const notInvoiced = d.R.faturasiz.map((r) => ({ "Gönderi tarihi": day(r.ship_date), "Konşimento": r.awb, "Yön": r.direction ?? "", "Karşı taraf": r.party_company ?? "", "Hekim": r.lab_customers?.name ?? "", "Ülke": r.party_country ?? "", "Hizmet": r.service ?? "", "Kg": r.weight ?? "", "Durum": r.status ?? "" }));
  const express = d.R.saat.map((r) => { const i = d.itemBy.get(`${r.carrier}|${r.awb}`); return { "Gönderi tarihi": day(r.ship_date), "Konşimento": r.awb, "Karşı taraf": r.party_company ?? "", "Hekim": r.lab_customers?.name ?? "", "Ülke": r.party_country ?? "", "Hizmet": r.service ?? "", "Kg": r.weight ?? "", "Fatura no": i?.carrier_invoices?.invoice_no ?? "", "Fatura (TL)": i ? tl2(i.total) : "" }; });
  const nocust = pick("nocust");

  const sheets: [string, string, Record<string, unknown>[]][] = [
    ["Beyandan ağır", `Bizim beyan ettiğimiz ağırlık (ve varsa hacim ağırlığı) 0,5 kg'a yuvarlandığında faturalanması gereken kg'dan daha ağır faturalanan gönderiler. ${N}'den tartı / ölçü (boyut) kanıtı ve düzeltme istenir.`, heavy],
    ["Mükerrer", "Aynı konşimento birden fazla faturada ücretlendirilmiş. İkinci faturalama iade edilmeli.", dup],
    ["Ek hizmet", "Sipariş etmediğimiz ya da gerekçesi belirsiz ek hizmet ücretleri (saatli teslim, ikamet adresi, adres düzeltme, uzak bölge vb.). Gerekçe ve kanıt istenir.", premium],
    ["Ortalamanın üstünde", "Aynı ülkeye benzer ağırlıktaki (0-1 / 1-3 / 3-7 / 7-15 / 15+ kg) gönderilere göre kg başı ücret, ortancadan %30'dan fazla yüksek. Tarife / indirim uygulaması sorgulanır.", pick("high")],
    ["Tahmini ücretten fazla", "Fatura tutarı (EUR karşılığı), gönderi oluşturulurken gösterilen tahmini ücretten %10'dan fazla yüksek.", fark],
    ["Faturada var listede yok", "Faturada ücretlendirilmiş ama bizim konşimento listemizde (oluşturduğumuz gönderiler) bulunmayan takip numaraları. Bize ait olmayan gönderi olabilir.", yok],
    ...(internal ? [
      ["Faturası gelmemiş", "Konşimento listemizde olan, 4 günden eski ama henüz hiçbir faturada görünmeyen gönderiler (iç takip; sonraki faturada gelebilir).", notInvoiced],
      ["Express (Saver değil)", carrier === "ups" ? "UPS Express ile gönderilmiş paketler; UPS Express Saver genelde daha ucuzdur (iç bilgi, itiraz konusu değil)." : "Express 9:00 / 10:30 / 12:00 seçilmiş gönderiler; standart Express daha ucuzdur (iç bilgi).", express],
      ["Hekim bulunamadı", "Alıcısı ERP'deki hiçbir hekim / müşteriyle eşleşmeyen satırlar (iç takip; maliyet hekime yansıtılamıyor).", nocust],
    ] as [string, string, Record<string, unknown>[]][] : []),
  ];
  const sum = (rows: Record<string, unknown>[], k: string) => rows.reduce((a, r) => a + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);
  const ozet = sheets.map(([n, desc, rows]) => ({ "Kontrol": n, "Adet": rows.length, "Tutar (TL)": Math.round((sum(rows, "Toplam (TL)") || sum(rows, "Fatura (TL)")) * 100) / 100, "Açıklama": desc }));
  const wb = XLSX.utils.book_new();
  const ws0 = XLSX.utils.json_to_sheet(ozet);
  ws0["!cols"] = [{ wch: 26 }, { wch: 8 }, { wch: 14 }, { wch: 120 }];
  XLSX.utils.book_append_sheet(wb, ws0, "Özet");
  for (const [n, desc, rows] of sheets) {
    if (!rows.length && !internal) continue;
    const ws = XLSX.utils.aoa_to_sheet([[desc], []]);
    XLSX.utils.sheet_add_json(ws, rows.length ? rows : [{ "Sonuç": "Bu kontrolde kayıt yok" }], { origin: "A3" });
    const keys = Object.keys(rows[0] ?? { Sonuç: 1 });
    ws["!cols"] = keys.map((k) => ({ wch: Math.min(48, Math.max(10, k.length + 2, ...rows.slice(0, 200).map((r) => String(r[k] ?? "").length + 1))) }));
    XLSX.utils.book_append_sheet(wb, ws, n.slice(0, 31));
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Kargo firmasına itiraz e-postası (Türkçe) */
export function disputeMail(d: CarrierReport, carrier: "dhl" | "ups") {
  const N = CARRIER_NAME[carrier];
  const heavy = heavyRows(d);
  const dup = d.items.filter((i) => i.flags.includes("dup"));
  const prem = d.items.filter((i) => i.flags.includes("premium"));
  const high = d.items.filter((i) => i.flags.includes("high"));
  const fark = d.R.fark;
  const yok = d.R.yok;
  const fmt = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const invNos = [...new Set([...heavy.map((h) => h.i), ...dup, ...prem, ...high, ...yok].map((i) => `${i.carrier_invoices?.invoice_no}${i.carrier_invoices?.invoice_date ? ` (${day(i.carrier_invoices.invoice_date)})` : ""}`))];
  const acct = carrier === "ups" ? " UPS hesap (gönderici) no: 7V6222." : "";
  const L: string[] = [];
  L.push(`Sayın ${N} Faturalama Ekibi,`, "");
  L.push(`MB Dental olarak ${invNos.length > 1 ? "aşağıdaki faturalarınızı" : `${invNos[0] ?? ""} numaralı faturanızı`} gönderi bazında kendi konşimento kayıtlarımızla karşılaştırdık.${acct}`);
  if (invNos.length > 1) L.push(`İlgili faturalar: ${invNos.join(", ")}`);
  L.push("", "Tespit ettiğimiz uyuşmazlıklar ve talebimiz aşağıdadır; gönderi bazında ayrıntılı liste ekteki Excel dosyasındadır.", "");
  let n = 1;
  if (heavy.length) {
    L.push(`${n++}) Beyan edilenden ağır faturalanan gönderiler — ${heavy.length} adet (toplam ${fmt(heavy.reduce((a, h) => a + h.i.total, 0))} TL)`);
    L.push("Gönderi oluştururken beyan ettiğimiz ağırlıktan daha yüksek kg üzerinden ücretlendirilmiş. Örnekler:");
    for (const h of heavy.slice(0, 8)) L.push(`  • ${h.r.awb} — fatura ${h.i.carrier_invoices?.invoice_no}: beyan ${h.declared} kg, faturalanan ${h.billed} kg (+${h.diff} kg), ${fmt(h.i.total)} TL`);
    if (heavy.length > 8) L.push(`  • … ve ${heavy.length - 8} gönderi daha (ekteki "Beyandan ağır" sayfası).`);
    L.push("Bu gönderiler için tartı kaydınızı ve hacim ağırlığı hesabında kullanılan paket ölçülerini (en × boy × yükseklik) paylaşmanızı; kanıtlanamayan farklar için beyan edilen ağırlık üzerinden yeniden hesaplama yapılarak iade / alacak faturası düzenlenmesini rica ederiz.", "");
  }
  if (dup.length) {
    L.push(`${n++}) Mükerrer faturalama — ${new Set(dup.map((i) => i.awb)).size} konşimento`);
    L.push("Aynı takip numarası birden fazla faturada ücretlendirilmiş: " + [...new Set(dup.map((i) => i.awb))].slice(0, 10).join(", ") + ". Tekrarlanan tutarların iadesini talep ediyoruz.", "");
  }
  if (prem.length) {
    L.push(`${n++}) Ek hizmet ücretleri — ${prem.length} gönderi`);
    for (const i of prem.slice(0, 8)) L.push(`  • ${i.awb} — fatura ${i.carrier_invoices?.invoice_no}: ${i.extras.filter((x) => PREMIUM.test(x.name)).map((x) => `${x.name} ${fmt(x.amount)} TL`).join(", ")}`);
    L.push("Bu ek hizmetleri talep etmedik / gerekçesini bilmiyoruz. Hangi gerekçeyle uygulandığını (ör. alıcı adresinin ikamet olarak sınıflandırılması, adres düzeltme kaydı) belgelemenizi, gerekçesiz olanların iptalini rica ederiz.", "");
  }
  if (high.length) {
    L.push(`${n++}) Tarifeye göre yüksek görünen ücretler — ${high.length} gönderi`);
    L.push("Aynı ülkeye benzer ağırlıktaki diğer gönderilerimize göre kg başı ücreti %30'dan fazla yüksek: " + high.slice(0, 8).map((i) => `${i.awb} (${i.weight ?? "?"} kg, ${fmt(i.total)} TL)`).join(", ") + ". Anlaşmalı indirimimizin uygulanıp uygulanmadığını kontrol etmenizi rica ederiz.", "");
  }
  if (fark.length) {
    L.push(`${n++}) Gönderi oluştururken gösterilen tahmini ücretten %10'dan fazla yüksek faturalanan ${fark.length} gönderi (ekte "Tahmini ücretten fazla"). Fark nedenini açıklamanızı rica ederiz.`, "");
  }
  if (yok.length) {
    L.push(`${n++}) Bize ait olmayabilecek gönderiler — ${yok.length} adet`);
    L.push("Şu takip numaraları faturada var ancak bizim oluşturduğumuz gönderiler arasında yok: " + yok.slice(0, 10).map((i) => i.awb).join(", ") + ". Gönderen bilgisi ve hesap eşleşmesini kontrol etmenizi rica ederiz.", "");
  }
  if (n === 1) L.push("Bu dönemde itiraz edilecek uyuşmazlık bulunmadı.", "");
  L.push("Söz konusu tutarlar netleşene kadar bu kalemlerin ödemesini bekletmek durumundayız. İncelemenizin sonucunu ve düzenlenecek alacak / düzeltme faturasını bu e-postaya yanıt olarak iletmenizi rica ederiz.", "");
  L.push("Saygılarımızla,", "MB Dental");
  const text = L.join("\n");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${text.split("\n\n").map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
  const first = invNos[0]?.split(" ")[0] ?? "";
  const subject = `Fatura itirazı – ${invNos.length > 1 ? `${invNos.length} fatura` : first} – MB Dental${carrier === "ups" ? " (7V6222)" : ""}`;
  const counts = { heavy: heavy.length, dup: new Set(dup.map((i) => i.awb)).size, premium: prem.length, high: high.length, fark: fark.length, yok: yok.length };
  return { subject, text, html, counts };
}
