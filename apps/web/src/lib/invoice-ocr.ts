import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { aiModel } from "@/lib/ai-model";
import type { InitialInvoice } from "@/app/(app)/fatura/_parts/InvoiceForm";

export type Out = {
  supplier_name?: string; supplier_tax_no?: string; supplier_tax_office?: string; supplier_address?: string; doc_no?: string; date?: string; due_date?: string; currency?: string;
  lines?: { name?: string; code?: string; qty?: number; unit?: string; unit_price?: number; discount_pct?: number; vat_rate?: number }[]; total?: number;
};
const RECEIPT_HINT = "Bu bir esnaf / tedarikçi fişi (yazar kasa fişi, perakende satış fişi ya da gider pusulası) — işletmenin yaptığı alış. Satıcı unvanı, adresi ve VKN fişin üst kısmındadır; fiş no doc_no'ya, tarih date'e. Fişteki fiyatlar KDV DAHİLDİR: unit_price'ı KDV hariç hesapla (KDV dahil birim fiyat ÷ (1 + oran/100)). KDV oranı yazmıyorsa toplam KDV'den bul, bulamazsan 20 yaz. Tek kalem okunabiliyorsa onu yaz; kalem okunamıyorsa fişin konusunu tek satır olarak yaz.";
const norm = (s: string) => s.toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Kağıt / PDF alış faturasını yapay zekâyla okuyup fatura formu için taslak üretir (receipts deposundaki kullanıcı dosyası) */
export async function readPurchaseInvoice(path: string, userId: string, opts: { receipt?: boolean } = {}): Promise<{ initial?: InitialInvoice; note: string; ok: boolean }> {
  if (!path.startsWith(`${userId}/`) || path.includes("..")) return { ok: false, note: "Dosyaya erişim yok." };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, note: "Fotoğraftan okuma için Vercel'e ANTHROPIC_API_KEY eklenmeli." };
  const supabase = await createClient();
  const { data: blob, error } = await supabase.storage.from("receipts").download(path);
  if (error || !blob) return { ok: false, note: "Dosya okunamadı." };
  if (blob.size > 8 * 1024 * 1024) return { ok: false, note: "Dosya çok büyük (en fazla 8 MB)." };
  const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
  const type = blob.type || (path.endsWith(".pdf") ? "application/pdf" : "image/jpeg");
  const media = type === "application/pdf"
    ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } } as const)
    : ({ type: "image", source: { type: "base64", media_type: (["image/png", "image/webp"].includes(type) ? type : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp", data: b64 } } as const);
  let d: Out;
  try {
    const res = await new Anthropic({ apiKey: key }).messages.create({
      model: aiModel(), max_tokens: 2500,
      messages: [{ role: "user", content: [media, { type: "text", text: `${opts.receipt ? RECEIPT_HINT : "Bu bir alış faturası (Türkiye ya da yurt dışı)."} Yalnız JSON döndür:
{"supplier_name":"satıcı unvanı","supplier_tax_no":"VKN/TCKN yalnız rakam","supplier_tax_office":"vergi dairesi","supplier_address":"adres","doc_no":"fatura no","date":"YYYY-MM-DD","due_date":"YYYY-MM-DD ya da boş","currency":"TRY|EUR|USD|GBP|CHF",
"lines":[{"name":"mal / hizmet adı","code":"satıcı ürün kodu","qty":miktar,"unit":"adet|kg|gr|lt|m|kutu|paket","unit_price":KDV HARİÇ birim fiyat (ondalık nokta ile),"discount_pct":iskonto yüzdesi,"vat_rate":KDV oranı}],
"total":KDV dahil genel toplam}
Okunamayan alanı boş bırak; satırları atlama.` }] }],
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    d = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Out;
  } catch (e) {
    return { ok: false, note: `Fatura okunamadı: ${(e as Error).message.slice(0, 120)}` };
  }
  if (opts.receipt) {
    const r = await initialFromRead(supabase, d, "Esnaf / tedarikçi fişi — fotoğraftan yapay zekâ ile okundu, kontrol edin", { attach_path: path, pay_default: "cash" });
    return { ...r, note: `Fiş okundu. ${r.note} Ödeme varsayılan olarak nakit (kasa) seçili; değiştirebilirsiniz.` };
  }
  return initialFromRead(supabase, d, "Fotoğraftan yapay zekâ ile okundu — kontrol edin", { attach_path: path });
}

/** Okunan fatura verisinden alış faturası formu: tedarikçi ve stok kartı eşleştirme */
export async function initialFromRead(supabase: Awaited<ReturnType<typeof createClient>>, d: Out, note: string, extra: Partial<InitialInvoice> = {}): Promise<{ initial: InitialInvoice; note: string; ok: boolean }> {
  const tax = (d.supplier_tax_no ?? "").replace(/\D/g, "");
  const [{ data: parties }, { data: items }] = await Promise.all([
    supabase.from("fin_parties").select("id, name, tax_no, currency").eq("is_active", true).limit(5000),
    supabase.from("stk_items").select("id, code, name, unit, vat_rate").eq("is_active", true).limit(5000),
  ]);
  const party = (parties ?? []).find((p) => tax.length >= 10 && p.tax_no === tax)
    ?? (d.supplier_name ? (parties ?? []).find((p) => norm(p.name) === norm(d.supplier_name!) || (norm(p.name).length > 6 && norm(d.supplier_name!).startsWith(norm(p.name)))) : undefined);
  const its = (items ?? []) as { id: string; code: string | null; name: string; unit: string; vat_rate: number | null }[];
  let matched = 0;
  const lines = (d.lines ?? []).filter((l) => l.name).slice(0, 80).map((l) => {
    const n = norm(l.name!);
    const it = its.find((i) => (l.code && i.code && i.code.toLowerCase() === l.code.toLowerCase()) || norm(i.name) === n) ?? its.find((i) => norm(i.name).length > 5 && (n.includes(norm(i.name)) || norm(i.name).includes(n)));
    if (it) matched++;
    return {
      item_id: it?.id ?? null, name: String(l.name).slice(0, 200), seller_code: l.code ? String(l.code).slice(0, 60) : null,
      qty: Math.max(0.001, Number(l.qty) || 1), unit: it?.unit ?? (l.unit || "adet"), unit_price: Math.max(0, Number(l.unit_price) || 0),
      discount_pct: Math.min(100, Math.max(0, Number(l.discount_pct) || 0)), vat_rate: [0, 1, 8, 10, 18, 20].includes(Number(l.vat_rate)) ? Number(l.vat_rate) : Number(it?.vat_rate ?? 20),
    };
  });
  const currency = ["TRY", "EUR", "USD", "GBP", "CHF"].includes(d.currency ?? "") ? d.currency! : party?.currency ?? "TRY";
  const initial: InitialInvoice = {
    type: "invoice", party_id: party?.id ?? undefined,
    new_party: party ? null : d.supplier_name ? { name: d.supplier_name.slice(0, 200), tax_no: tax.length >= 10 ? tax : undefined, tax_office: d.supplier_tax_office?.slice(0, 80), address: d.supplier_address?.slice(0, 400) } : null,
    doc_no: d.doc_no?.slice(0, 60) ?? null, invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(d.date ?? "") ? d.date! : undefined,
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(d.due_date ?? "") ? d.due_date! : null, currency, lines,
    note, ...extra,
  };
  const parts = [`${lines.length} satır okundu, ${matched} tanesi stok kartıyla eşleşti.`];
  parts.push(party ? `Tedarikçi: ${party.name}.` : d.supplier_name ? `Tedarikçi kayıtlı değil; "${d.supplier_name}" yeni cari olarak açılacak.` : "Tedarikçi okunamadı; seçin.");
  if (d.total) parts.push(`Faturadaki genel toplam: ${Number(d.total).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${currency} — formdaki toplamla karşılaştırın.`);
  return { ok: true, initial, note: parts.join(" ") };
}
