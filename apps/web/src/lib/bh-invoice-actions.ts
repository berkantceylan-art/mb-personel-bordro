"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import type { BhInvoice } from "@/lib/bh-invoice";

export type PartyOpt = { id: string; name: string; currency: string; hekim: boolean; tax_no: string | null };

const N = (s: string) => s.toLocaleUpperCase("tr").replace(/İ/g, "I").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\b(L'|D')/g, "").replace(/[^A-Z0-9 ]/g, " ")
  .replace(/\b(SAS|SARL|SA|AS|LTD|STI|SIRKETI|TIC|SAN|VE|OZEL|AGIZ|DIS|SAGLIGI|HIZMETLERI|POLIKLINIGI|LIMITED|ANONIM|DR|TURKEY)\b/g, " ")
  .replace(/\s+/g, " ").trim();
const validTax = (t: string | null) => !!t && /^\d{10,11}$/.test(t) && !/^(\d)\1+$/.test(t);

async function guard() {
  const s = await getSession();
  if ((s.modules.sales ?? 0) < 2) throw new Error("Satış faturası aktarmak için yetkiniz yok.");
}

/** Müşteri adlarını cari kartlarla eşleştir (öneri) */
export async function bhSuggest(customers: { name: string; tax_no: string | null }[]): Promise<{ ok: boolean; message?: string; parties?: PartyOpt[]; match?: Record<string, string | null> }> {
  try {
    await guard();
    const sb = await createClient();
    const { data, error } = await sb.from("fin_parties").select("id, name, currency, tax_no, lab_customer_id, kind").eq("is_active", true).in("kind", ["customer", "both", "other"]).order("name").limit(1000);
    if (error) return { ok: false, message: error.message };
    const parties = (data ?? []).map((p) => ({ id: p.id as string, name: p.name as string, currency: p.currency as string, hekim: !!p.lab_customer_id, tax_no: (p.tax_no as string | null) ?? null }));
    const match: Record<string, string | null> = {};
    for (const c of customers) {
      const n = N(c.name);
      const toks = n.split(" ").filter((x) => x.length > 2);
      let hit = validTax(c.tax_no) ? parties.find((p) => p.tax_no === c.tax_no) : undefined;
      hit ??= parties.find((p) => N(p.name) === n);
      hit ??= parties.filter((p) => p.hekim).find((p) => { const pt = N(p.name).split(" ").filter((x) => x.length > 2); return pt.length > 0 && pt.every((x) => toks.includes(x)); });
      hit ??= parties.filter((p) => p.hekim).find((p) => { const pn = N(p.name); return toks.length > 0 && toks.every((x) => pn.includes(x)); });
      match[c.name] = hit?.id ?? null;
    }
    return { ok: true, parties, match };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Yurt dışı müşterinin adresinden ülke kodu (bulunamazsa boş: sunucu "YURTDIŞI" yazar) */
function guessCountry(address: string | null): string {
  const a = ` ${(address ?? "").toLocaleUpperCase("tr-TR").replace(/[^A-ZÇĞİÖŞÜ]+/g, " ")} `;
  const map: Array<[RegExp, string]> = [
    [/ (FRANCE|FRANSA) /, "FR"], [/ (BELGIQUE|BELGIUM|BELÇİKA|BELGIE) /, "BE"], [/ (SUISSE|SWITZERLAND|SCHWEIZ|İSVİÇRE) /, "CH"],
    [/ (DEUTSCHLAND|GERMANY|ALMANYA) /, "DE"], [/ (LUXEMBOURG|LÜKSEMBURG) /, "LU"], [/ (NETHERLANDS|NEDERLAND|HOLLANDA) /, "NL"],
    [/ (UNITED KINGDOM|ENGLAND|İNGİLTERE) /, "GB"], [/ (ITALIA|ITALY|İTALYA) /, "IT"], [/ (ESPAÑA|ESPANA|SPAIN|İSPANYA) /, "ES"],
    [/ (AUSTRIA|ÖSTERREICH|AVUSTURYA) /, "AT"],
  ];
  return map.find(([re]) => re.test(a))?.[1] ?? "";
}

/** choice: cari id | "new" (yeni cari kart) */
export async function bhImport(invoices: BhInvoice[], choice: Record<string, string>): Promise<{ ok: boolean; message: string; errors?: { doc_no: string; error: string }[] }> {
  try {
    await guard();
    const sb = await createClient();
    const rows = invoices.filter((i) => choice[i.customer] && choice[i.customer] !== "skip").map((i) => ({
      ...(choice[i.customer] === "new"
        ? { new_party: { name: i.customer, tax_no: i.tax_no, address: i.address, country: i.foreign ? guessCountry(i.address) : "TR", currency: i.currency } }
        : { party_id: choice[i.customer] }),
      doc_no: i.doc_no, date: i.date, due: i.due, currency: i.currency, rate: i.rate, tax_no: i.tax_no,
      profile: i.vat > 0 || !i.foreign ? "TICARIFATURA" : "IHRACAT",
      note: ["Bizim Hesap'tan aktarıldı", i.note].filter(Boolean).join(" · "), lines: i.lines,
    }));
    let ins = 0, skip = 0, created = 0;
    const errors: { doc_no: string; error: string }[] = [];
    for (let k = 0; k < rows.length; k += 25) {
      const { data, error } = await sb.rpc("inv_import_external", { p: rows.slice(k, k + 25) });
      if (error) return { ok: false, message: /inv_import_external|schema cache/i.test(error.message) ? "Önce mbdental-fatura-aktar.sql dosyasını Supabase'de çalıştırın." : error.message };
      const r = data as { inserted: number; skipped: number; parties_created: number; errors: { doc_no: string; error: string }[] };
      ins += r.inserted; skip += r.skipped; created += r.parties_created; errors.push(...r.errors);
    }
    revalidatePath("/satis/faturalar");
    revalidatePath("/finans/cariler");
    return { ok: errors.length === 0, message: `${ins} fatura aktarıldı${skip ? `, ${skip} fatura zaten vardı (atlandı)` : ""}${created ? `, ${created} yeni cari kart açıldı` : ""}${errors.length ? `, ${errors.length} fatura aktarılamadı` : ""}.`, errors };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
