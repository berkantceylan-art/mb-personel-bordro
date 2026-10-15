import "server-only";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiModel } from "@/lib/ai-model";
import type { Out } from "@/lib/invoice-ocr";

/** PDF'ten okunan e-belge (gelen kutusu satırı) */
export type PdfRow = {
  ettn: string; direction: "in"; doc_kind: "earsiv" | "efatura"; doc_no: string; issue_date: string | null; profile: string; type_code: string;
  sender_vkn: string; sender_name: string; currency: string; payable: number; vat_total: number; line_count: number; pdf_path: string; ai_data: AiData; source_ref: string | null;
};
export type AiData = Out & { ettn?: string; buyer_tax_no?: string; kind?: string; vat_total?: number; payable?: number; is_invoice?: boolean };

export const pdfReaderConfigured = () => !!process.env.ANTHROPIC_API_KEY;
const DOC_NO = /^[A-Z0-9]{3}20\d{11}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ETTN basılı değilse satıcı VKN + fatura no'dan sabit bir kimlik (aynı fatura ikinci kez girilmesin) */
function derivedEttn(vkn: string, docNo: string) {
  const h = createHash("md5").update(`earsiv:${vkn}:${docNo}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * e-Arşiv / e-Fatura PDF'ini yapay zekâyla okur. Fatura değilse, bize kesilmemişse ya da e-belge numarası yoksa null + neden.
 * Kayıt: PDF "documents" deposuna (admin istemcisi) einv/<ettn>.pdf olarak yazılır.
 */
export async function readEinvPdf(admin: SupabaseClient, buf: Buffer, ownVkn: string | null, ref: string | null): Promise<{ row?: PdfRow; reason?: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { reason: "Vercel'de ANTHROPIC_API_KEY yok" };
  if (buf.length > 8 * 1024 * 1024) return { reason: "PDF 8 MB'tan büyük" };
  let d: AiData;
  try {
    const res = await new Anthropic({ apiKey: key }).messages.create({
      model: aiModel(), max_tokens: 3000,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } },
        { type: "text", text: `Bu belge Türkiye'de düzenlenmiş bir e-Arşiv fatura ya da e-Fatura mı? Yalnız JSON döndür:
{"is_invoice":true|false,"kind":"earsiv|efatura|other","ettn":"ETTN (UUID, 36 karakter) ya da boş","doc_no":"fatura no (16 karakter, ör. ABC2026000000123)","date":"YYYY-MM-DD","due_date":"YYYY-MM-DD ya da boş",
"supplier_name":"satıcı unvanı","supplier_tax_no":"satıcı VKN/TCKN yalnız rakam","supplier_tax_office":"vergi dairesi","supplier_address":"adres","buyer_tax_no":"alıcı VKN/TCKN yalnız rakam","currency":"TRY|EUR|USD|GBP|CHF",
"lines":[{"name":"mal / hizmet","code":"ürün kodu","qty":miktar,"unit":"adet|kg|gr|lt|m|kutu|paket","unit_price":KDV HARİÇ birim fiyat,"discount_pct":iskonto yüzdesi,"vat_rate":KDV oranı}],
"vat_total":toplam KDV,"payable":ödenecek tutar,"total":KDV dahil genel toplam}
Fatura değilse (teklif, ekstre, irsaliye, makbuz vb.) is_invoice=false. Okunamayan alanı boş bırak; satırları atlama; sayılarda ondalık nokta kullan.` },
      ] }],
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    d = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as AiData;
  } catch (e) {
    return { reason: `okunamadı: ${(e as Error).message.slice(0, 100)}` };
  }
  if (!d.is_invoice || d.kind === "other") return { reason: "fatura değil" };
  const docNo = (d.doc_no ?? "").replace(/\s/g, "").toUpperCase();
  const vkn = (d.supplier_tax_no ?? "").replace(/\D/g, "");
  const buyer = (d.buyer_tax_no ?? "").replace(/\D/g, "");
  if (!DOC_NO.test(docNo)) return { reason: "e-belge fatura numarası yok" };
  if (vkn.length !== 10 && vkn.length !== 11) return { reason: "satıcı VKN okunamadı" };
  if (ownVkn && vkn === ownVkn) return { reason: "kendi kestiğimiz fatura" };
  if (ownVkn && buyer && buyer !== ownVkn) return { reason: "başka firmaya kesilmiş" };
  const ettn = UUID.test((d.ettn ?? "").trim()) ? d.ettn!.trim().toLowerCase() : derivedEttn(vkn, docNo);
  const path = `einv/${ettn}.pdf`;
  const up = await admin.storage.from("documents").upload(path, buf, { contentType: "application/pdf", upsert: true });
  if (up.error) return { reason: `PDF saklanamadı: ${up.error.message}` };
  const cur = ["TRY", "EUR", "USD", "GBP", "CHF"].includes(d.currency ?? "") ? d.currency! : "TRY";
  const kurus = (v: unknown) => Math.round((Number(v) || 0) * 100);
  return {
    row: {
      ettn, direction: "in", doc_kind: d.kind === "efatura" ? "efatura" : "earsiv", doc_no: docNo, issue_date: /^\d{4}-\d{2}-\d{2}$/.test(d.date ?? "") ? d.date! : null,
      profile: d.kind === "efatura" ? "TEMELFATURA" : "EARSIVFATURA", type_code: "SATIS", sender_vkn: vkn, sender_name: (d.supplier_name ?? "—").slice(0, 250), currency: cur,
      payable: kurus(d.payable ?? d.total), vat_total: kurus(d.vat_total), line_count: (d.lines ?? []).length, pdf_path: path, ai_data: { ...d, doc_no: docNo, ettn }, source_ref: ref,
    },
  };
}
