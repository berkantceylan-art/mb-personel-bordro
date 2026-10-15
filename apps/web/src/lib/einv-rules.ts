/** e-Belge kuralları: senaryo / tip çözümü ve gönderim öncesi Türkçe denetim (istemcide de çalışır) */
import { EINV_PROFILES, PROFILE_TYPES, WITHHOLDINGS } from "@/lib/einv-codes";
import type { Company, InvLine, Invoice } from "@/lib/invoice";

const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
const isTR = (c: string | null | undefined) => !c || ["TR", "TÜRKIYE", "TÜRKİYE", "TURKEY", "TURKIYE"].includes(c.trim().toLocaleUpperCase("tr-TR"));

// ---------------------------------------------------------------------
// Senaryo / tip çözümü ve doğrulama
// ---------------------------------------------------------------------
export type EdocCtx = { party?: { is_einvoice?: boolean; country?: string | null; foreign_tax_id?: string | null } | null; returnOf?: { doc_no: string; date: string } | null };

/** Belgeyi kim kesiyor: satış faturası ve alış iadesi bizden çıkar */
export const weIssue = (inv: Pick<Invoice, "direction" | "type">) => (inv.direction === "sale" && inv.type === "invoice") || (inv.direction === "purchase" && inv.type === "return");

export function resolveDoc(inv: Invoice, lines: InvLine[]): { profile: string; typeCode: string } {
  const withholding = Number(inv.withholding_total) > 0;
  const isReturn = inv.type === "return";
  let profile = inv.profile === "KAGIT" ? "TEMELFATURA" : inv.profile;
  if (isReturn && profile === "TICARIFATURA") profile = "TEMELFATURA";
  let typeCode = inv.type_code ?? "";
  if (!typeCode) {
    const codes = lines.filter((l) => Number(l.vat_rate) === 0).map((l) => l.vat_exemption_code ?? "351");
    if (isReturn) typeCode = "IADE";
    else if (withholding) typeCode = "TEVKIFAT";
    else if (profile === "IHRACAT") typeCode = "ISTISNA";
    else if (codes.some((c) => /^7/.test(c))) typeCode = "IHRACKAYITLI";
    else if (codes.some((c) => /^[23]/.test(c))) typeCode = "ISTISNA";
    else typeCode = "SATIS";
  }
  return { profile, typeCode };
}

/** Gönderim öncesi denetim: Türkçe hata listesi (boşsa gönderilebilir) */
export function validateEdoc(inv: Invoice, lines: InvLine[], co: Company, ctx: EdocCtx = {}): string[] {
  const e: string[] = [];
  const { profile, typeCode } = resolveDoc(inv, lines);
  const pName = EINV_PROFILES[profile]?.label ?? profile;
  if (!weIssue(inv)) e.push(inv.direction === "sale" ? "Satış iadesinde iade faturasını hekim / alıcı keser; gelen belgeyi e-Belgeler ekranından aktarın." : "Alış faturasını tedarikçi keser.");
  if (inv.profile === "KAGIT") e.push("Kâğıt fatura elektronik gönderilmez; senaryoyu değiştirin.");
  if (!PROFILE_TYPES[profile]?.includes(typeCode)) e.push(`${pName} senaryosunda "${typeCode}" tipi kesilemez (izin verilenler: ${(PROFILE_TYPES[profile] ?? []).join(", ")}).`);
  if (digits(co.tax_no).length < 10) e.push("Şirketin VKN'si eksik (Ayarlar › Şirket).");
  if (!co.tax_office) e.push("Şirketin vergi dairesi eksik (Ayarlar › Şirket).");
  if (!co.address || !co.city) e.push("Şirket adresi / ili eksik (Ayarlar › Şirket).");
  const tax = digits(inv.party_tax_no);
  const foreign = !isTR(inv.party_country);
  if (!inv.party_name) e.push("Alıcı adı eksik.");
  if (EINV_PROFILES[profile]?.kind === "efatura" && profile !== "IHRACAT" && tax.length !== 10 && tax.length !== 11) e.push("e-Fatura için alıcının VKN / TCKN'si gerekli.");
  if (profile === "EARSIVFATURA" && ctx.party?.is_einvoice) e.push("Alıcı e-Fatura mükellefi: e-Arşiv kesilemez, senaryoyu e-Fatura yapın.");
  if (EINV_PROFILES[profile]?.kind === "efatura" && profile !== "IHRACAT" && ctx.party && ctx.party.is_einvoice === false) e.push("Alıcı GİB listesinde e-Fatura mükellefi görünmüyor: e-Arşiv kesin (ya da cari kartından mükellef bilgisini yenileyin).");
  if (inv.currency !== "TRY" && !(Number(inv.rate) > 0)) e.push("Döviz kuru eksik.");
  if (typeCode === "IADE" && !ctx.returnOf?.doc_no) e.push("İade faturasında iade edilen faturanın numarası ve tarihi gerekli (faturayı asıl faturadan “İade” ile oluşturun).");
  if (typeCode === "TEVKIFAT" && !lines.some((l) => Number(l.withholding) > 0)) e.push("Tevkifatlı faturada en az bir satırda tevkifat oranı olmalı.");
  if (typeCode !== "TEVKIFAT" && typeCode !== "IADE" && lines.some((l) => Number(l.withholding) > 0)) e.push(`Tevkifat oranı olan satır var ama tip "${typeCode}".`);
  for (const l of lines.filter((x) => Number(x.withholding) > 0)) {
    if (!l.withholding_code) { e.push(`"${l.name}" satırında tevkifat kodu eksik.`); continue; }
    const std = WITHHOLDINGS.find((w) => w[0] === l.withholding_code)?.[2] ?? (/^8\d\d$/.test(l.withholding_code) ? 100 : null);
    if (std != null && Number(l.withholding_rate) !== std) e.push(`"${l.name}" satırında ${l.withholding_code} kodunun oranı %${std} olmalı (girilen %${Number(l.withholding_rate)}).`);
  }
  const zero = lines.filter((l) => Number(l.vat_rate) === 0);
  if (typeCode === "ISTISNA") {
    if (!zero.length) e.push("İstisna faturasında %0 KDV'li satır olmalı.");
    for (const l of zero) if (!/^[23]\d\d$/.test(l.vat_exemption_code ?? "")) e.push(`"${l.name}" satırında istisna kodu (2xx / 3xx) seçilmeli.`);
  }
  if (typeCode === "IHRACKAYITLI") for (const l of zero) if (!/^7\d\d$/.test(l.vat_exemption_code ?? "")) e.push(`"${l.name}" satırında ihraç kayıtlı kodu (701–704) seçilmeli.`);
  if (typeCode === "SATIS") for (const l of zero) if (/^[237]/.test(l.vat_exemption_code ?? "") ) e.push(`"${l.name}" satırı istisna kodlu; tipi İstisna / İhraç kayıtlı yapın ya da kodu 351 seçin.`);
  if (profile === "IHRACAT") {
    if (!foreign) e.push("İhracat faturasında alıcı yurt dışında olmalı (cari kartında ülke).");
    if (!inv.incoterm) e.push("İhracat: teslim şartı (INCOTERMS) seçilmeli.");
    if (!inv.transport_mode) e.push("İhracat: taşıma şekli seçilmeli.");
    if (!inv.package_kind || !inv.package_count) e.push("İhracat: kap cinsi ve adedi girilmeli.");
    for (const l of lines) {
      if (!l.gtip) e.push(`"${l.name}" satırında GTİP kodu eksik.`);
      if (Number(l.vat_rate) !== 0) e.push(`"${l.name}" satırı ihracatta %0 KDV olmalı.`);
      if (!(Number(l.unit_price) > 0)) e.push(`"${l.name}" satırında fiyat 0 olamaz.`);
    }
  }
  if (profile === "KAMU" && !co.einv_iban) e.push("Kamu faturası için şirket IBAN'ı gerekli (Satış › Ayarlar › e-Belge).");
  if (profile === "ILAC_TIBBICIHAZ") {
    if (!lines.some((l) => l.ident_scheme === "TIBBICIHAZ" || l.ident_scheme === "ILAC")) e.push("İlaç / tıbbi cihaz senaryosunda en az bir satırda ÜTS / İTS ürün tanımlayıcı olmalı (diğerleri “Diğer”).");
    for (const l of lines.filter((x) => (x.ident_scheme === "TIBBICIHAZ" || x.ident_scheme === "ILAC") && !x.ident)) e.push(`"${l.name}" satırında ürün tanımlayıcı değeri eksik.`);
  }
  if (typeCode === "IHRACKAYITLI" && zero.some((l) => l.vat_exemption_code === "702") && lines.some((l) => l.vat_exemption_code === "702" && (!l.gtip || !l.diib_line))) e.push("702 kodlu satırlarda GTİP ve DİİB satır kodu gerekli.");
  if (inv.online_sale && profile === "EARSIVFATURA") {
    if (!inv.pay_method) e.push("İnternet satışı: ödeme şekli seçilmeli.");
    if (!inv.pay_date) e.push("İnternet satışı: ödeme tarihi girilmeli.");
    if (!co.einv_web && !co.website) e.push("İnternet satışı: şirket web adresi gerekli (Satış › Ayarlar › e-Belge).");
  }
  return [...new Set(e)];
}

export type Despatch = {
  id: string; doc_no: string | null; ettn: string; type_code: "SEVK" | "MATBUDAN"; issue_date: string; issue_time: string | null; ship_date: string; ship_time: string | null;
  party_name: string; party_tax_no: string | null; party_tax_office: string | null; party_address: string | null; party_district: string | null; party_city: string | null; party_country: string | null; party_email: string | null;
  delivery_address: string | null; plate: string | null; trailer_plate: string | null; driver_name: string | null; driver_tckn: string | null; carrier_name: string | null; carrier_tax_no: string | null;
  matbu_no: string | null; matbu_date: string | null; order_no: string | null; order_date: string | null; note: string | null;
};
export type DespatchLine = { name: string; qty: number; unit: string; seller_code: string | null; unit_price: number | null; currency: string | null };

export function validateDespatch(d: Despatch, lines: DespatchLine[], co: Company): string[] {
  const e: string[] = [];
  if (digits(co.tax_no).length < 10) e.push("Şirketin VKN'si eksik (Ayarlar › Şirket).");
  if (!d.party_name) e.push("Alıcı adı eksik.");
  const t = digits(d.party_tax_no);
  if (t.length !== 10 && t.length !== 11) e.push("Alıcının VKN / TCKN'si gerekli.");
  if (!lines.length) e.push("En az bir satır olmalı.");
  if (!d.plate) e.push("Araç plakası zorunlu (kargo ile gönderimde kargo aracının plakası).");
  if (!d.driver_name && !d.carrier_name) e.push("Şoför ya da taşıyıcı firma bilgisi girilmeli.");
  if (d.plate && !/^(0[1-9]|[1-7][0-9]|8[01])[A-Z]{1,3}[0-9]{2,5}$/.test(d.plate.replace(/\s/g, "").toUpperCase())) e.push("Plaka biçimi hatalı (ör. 34ABC123).");
  if (d.driver_name && digits(d.driver_tckn).length !== 11) e.push("Şoförün TCKN'si (11 hane) gerekli.");
  if (d.carrier_name && digits(d.carrier_tax_no).length < 10) e.push("Taşıyıcı firmanın VKN'si gerekli.");
  if (d.type_code === "MATBUDAN" && (!d.matbu_no || !d.matbu_date)) e.push("Matbudan irsaliyede kâğıt irsaliyenin numarası ve tarihi gerekli.");
  if (`${d.ship_date}T${(d.ship_time ?? "23:59").slice(0, 5)}` < `${d.issue_date}T${(d.issue_time ?? "00:00").slice(0, 5)}`) e.push("Fiili sevk zamanı düzenleme zamanından önce olamaz.");
  return e;
}

