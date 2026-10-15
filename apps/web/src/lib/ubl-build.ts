/**
 * UBL-TR 1.2 belge üretimi: e-Fatura / e-Arşiv faturası (tüm senaryo ve tipler) ve e-İrsaliye.
 * XML yapısı json2ubl-ts ile kurulur (GİB şema ve şematron kurallarına göre doğrulanır);
 * tutarlar ERP'nin kuruş hassasiyetindeki değerleriyle yazılır (muhasebe kaydıyla birebir aynı olsun diye).
 * İmzasız üretilir; eLogo imzalar (SIGNED=0).
 */
import "server-only";
import { DespatchBuilder, InvoiceBuilder, SimpleInvoiceBuilder, UblBuildError, mapSimpleToDespatchInput, type SimpleDespatchInput, type SimpleInvoiceInput, type SimpleLineInput, type SimplePartyInput } from "json2ubl-ts";
import { CUSTOMS_PARTY, EXEMPTION_TEXT, WITHHOLDINGS } from "@/lib/einv-codes";
import { resolveDoc, type Despatch, type DespatchLine, type EdocCtx } from "@/lib/einv-rules";
export { resolveDoc, validateDespatch, validateEdoc, weIssue, type Despatch, type DespatchLine, type EdocCtx } from "@/lib/einv-rules";
import { UNIT_CODE, type Company, type InvLine, type Invoice } from "@/lib/invoice";

const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
const isTR = (c: string | null | undefined) => !c || ["TR", "TÜRKIYE", "TÜRKİYE", "TURKEY", "TURKIYE"].includes(c.trim().toLocaleUpperCase("tr-TR"));
const countryName = (c: string | null | undefined) => (isTR(c) ? "Türkiye" : (c ?? "").trim());
const m = (minor: number | string | null | undefined) => Math.round(Number(minor ?? 0)) / 100;
/** İl adı → plaka kodu (posta kodu bilinmiyorsa "34000" gibi il merkezi kodu) */
const ILLER = ["Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Amasya", "Ankara", "Antalya", "Artvin", "Aydın", "Balıkesir", "Bilecik", "Bingöl", "Bitlis", "Bolu", "Burdur", "Bursa", "Çanakkale", "Çankırı", "Çorum", "Denizli", "Diyarbakır", "Edirne", "Elazığ", "Erzincan", "Erzurum", "Eskişehir", "Gaziantep", "Giresun", "Gümüşhane", "Hakkari", "Hatay", "Isparta", "Mersin", "İstanbul", "İzmir", "Kars", "Kastamonu", "Kayseri", "Kırklareli", "Kırşehir", "Kocaeli", "Konya", "Kütahya", "Malatya", "Manisa", "Kahramanmaraş", "Mardin", "Muğla", "Muş", "Nevşehir", "Niğde", "Ordu", "Rize", "Sakarya", "Samsun", "Siirt", "Sinop", "Sivas", "Tekirdağ", "Tokat", "Trabzon", "Tunceli", "Şanlıurfa", "Uşak", "Van", "Yozgat", "Zonguldak", "Aksaray", "Bayburt", "Karaman", "Kırıkkale", "Batman", "Şırnak", "Bartın", "Ardahan", "Iğdır", "Yalova", "Karabük", "Kilis", "Osmaniye", "Düzce"];
const norm = (v: string) => v.toLocaleLowerCase("tr-TR").replace(/[^a-zçğıöşü]/g, "");
export function postalOf(city: string | null | undefined, fallback?: string | null): string {
  const i = city ? ILLER.findIndex((x) => norm(x) === norm(city)) : -1;
  if (i >= 0) return `${String(i + 1).padStart(2, "0")}000`;
  return fallback && /^((0[1-9])|([1-7][0-9])|(8[0-1]))\d{3}$/.test(fallback) ? fallback : "34000";
}

// ---------------------------------------------------------------------
// Fatura XML
// ---------------------------------------------------------------------
export class EdocBuildError extends Error { constructor(public errors: string[]) { super(errors.join(" • ")); } }

function senderOf(co: Company): SimplePartyInput {
  const ids = [co.mersis_no ? { schemeId: "MERSISNO", value: co.mersis_no } : null, co.trade_registry_no ? { schemeId: "TICARETSICILNO", value: co.trade_registry_no } : null].filter(Boolean) as { schemeId: string; value: string }[];
  return {
    taxNumber: digits(co.tax_no), name: co.name, taxOffice: co.tax_office ?? undefined, address: co.address || "-", district: co.district || co.city || "-", city: co.city || "-",
    country: countryName(co.country), zipCode: co.postal_code || undefined, phone: co.phone || undefined, email: co.email || undefined, website: co.einv_web || co.website || undefined,
    identifications: ids.length ? ids : undefined,
  };
}

export type BuildOpts = EdocCtx & { emptyId?: boolean; time?: string };
const PLACEHOLDER = (year: string) => `ZZZ${year}000000001`;
const PAYMENT_CODE: Record<string, string> = { "KREDIKARTI/BANKAKARTI": "48", "EFT/HAVALE": "42", KAPIDAODEME: "10", ODEMEARACISI: "ZZZ", DIGER: "ZZZ" };

/** Fatura → UBL-TR XML (satış faturası ya da alış iadesi; biz satıcıyız). Kurallara uymazsa EdocBuildError. */
export function buildUbl(inv: Invoice, lines: InvLine[], co: Company, opts: BuildOpts = {}): string {
  const { profile, typeCode } = resolveDoc(inv, lines);
  const earsiv = profile === "EARSIVFATURA";
  const exportInv = profile === "IHRACAT";
  const foreign = !isTR(inv.party_country);
  const year = inv.invoice_date.slice(0, 4);
  const id = opts.emptyId || !inv.doc_no ? PLACEHOLDER(year) : inv.doc_no;
  const addr = { address: inv.delivery_address || inv.party_address || "-", district: inv.party_district || inv.party_city || "-", city: inv.party_city || "-", country: countryName(inv.party_country) };
  const customer: SimplePartyInput = exportInv
    ? { taxNumber: CUSTOMS_PARTY.vkn, name: CUSTOMS_PARTY.name, taxOffice: CUSTOMS_PARTY.office, address: CUSTOMS_PARTY.office, district: CUSTOMS_PARTY.office, city: CUSTOMS_PARTY.city }
    : {
        taxNumber: digits(inv.party_tax_no) || (foreign ? "2222222222" : "11111111111"), name: inv.party_name ?? "", taxOffice: inv.party_tax_office ?? undefined,
        address: inv.party_address || "-", district: inv.party_district || inv.party_city || "-", city: inv.party_city || "-", country: countryName(inv.party_country), email: inv.party_email || undefined,
      };
  const zeroCodes = lines.filter((l) => Number(l.vat_rate) === 0).map((l) => l.vat_exemption_code ?? "351");
  const docExemption = typeCode === "ISTISNA" || typeCode === "IHRACKAYITLI" ? zeroCodes.find((c) => /^[237]/.test(c)) : undefined;
  const simpleLines: SimpleLineInput[] = lines.map((l) => {
    const zero = Number(l.vat_rate) === 0;
    const delivery = exportInv || (typeCode === "IHRACKAYITLI" && l.vat_exemption_code === "702")
      ? {
          deliveryAddress: addr,
          ...(exportInv ? { deliveryTermCode: inv.incoterm ?? undefined, transportModeCode: inv.transport_mode ? String(inv.transport_mode) : undefined, packageId: inv.package_no || "1", packageQuantity: inv.package_count ?? 1, packageTypeCode: inv.package_kind ?? undefined } : {}),
          gtipNo: l.gtip ? l.gtip.replace(/\D/g, "") : undefined,
          ...(l.vat_exemption_code === "702" && l.diib_line ? { alicidibsatirkod: l.diib_line } : {}),
        }
      : undefined;
    return {
      name: l.name, quantity: Number(l.qty), price: Number(l.unit_price), unitCode: UNIT_CODE[l.unit] ?? "C62", kdvPercent: Number(l.vat_rate),
      kdvExemptionCode: zero ? l.vat_exemption_code ?? "351" : undefined,
      allowancePercent: Number(l.discount_pct) > 0 ? Number(l.discount_pct) : undefined,
      withholdingTaxCode: Number(l.withholding) > 0 ? l.withholding_code ?? undefined : undefined,
      sellerCode: l.seller_code ?? undefined,
      note: !delivery && l.gtip ? `GTİP: ${l.gtip}` : undefined,
      delivery,
      additionalItemIdentifications: profile === "ILAC_TIBBICIHAZ" ? [{ schemeId: l.ident_scheme ?? "DIGER", value: l.ident || l.seller_code || l.name }] : undefined,
    };
  });
  const notes = [
    inv.note, co.inv_note,
    inv.export_doc_no ? `${inv.export_doc_kind === "etgb" ? "ETGB" : "Gümrük beyannamesi"} no: ${inv.export_doc_no}${inv.export_doc_date ? ` · ${inv.export_doc_date}` : ""}` : null,
    foreign && !exportInv && opts.party?.foreign_tax_id ? `Alıcı vergi no: ${opts.party.foreign_tax_id}` : null,
  ].filter(Boolean) as string[];
  const input: SimpleInvoiceInput = {
    sender: senderOf(co), customer, lines: simpleLines, id, uuid: inv.ettn,
    datetime: `${inv.invoice_date}T${(opts.time ?? inv.invoice_time ?? "12:00:00").slice(0, 8)}`,
    type: typeCode, profile, currencyCode: inv.currency, exchangeRate: inv.currency !== "TRY" ? Number(inv.rate) : undefined,
    kdvExemptionCode: docExemption,
    billingReference: opts.returnOf ? { id: opts.returnOf.doc_no, issueDate: opts.returnOf.date } : undefined,
    notes: notes.length ? notes : undefined,
    buyerCustomer: profile === "KAMU" ? {
      name: inv.buyer_name || inv.party_name || "", taxNumber: digits(inv.buyer_tax_no) || digits(inv.party_tax_no), address: inv.party_address || "-", city: inv.party_city || "-", district: inv.party_district || inv.party_city || "-", country: "Türkiye", taxOffice: inv.party_tax_office ?? undefined,
    } : exportInv ? { name: inv.party_name ?? "", taxNumber: opts.party?.foreign_tax_id || "-", address: inv.party_address || "-", city: inv.party_city || "-", district: inv.party_district || inv.party_city || "-", country: countryName(inv.party_country), email: inv.party_email || undefined } : undefined,
    paymentMeans: profile === "KAMU" ? { meansCode: "42", accountNumber: co.einv_iban ?? undefined, dueDate: inv.due_date ?? undefined }
      : inv.due_date && !(earsiv && inv.online_sale) ? { meansCode: "ZZZ", dueDate: inv.due_date } : undefined,
    eArchiveInfo: earsiv ? { sendType: inv.send_method === "KAGIT" ? "KAGIT" : "ELEKTRONIK" } : undefined,
    onlineSale: earsiv && inv.online_sale ? {
      isOnlineSale: true, storeUrl: co.einv_web || co.website || "", paymentMethod: inv.pay_method ?? "DIGER", paymentDate: inv.pay_date ?? inv.invoice_date,
      carrierTaxNumber: inv.carrier_tax_no ?? undefined, carrierName: inv.carrier_name ?? undefined, carrierDistrict: inv.carrier_name ? "-" : undefined, carrierCity: inv.carrier_name ? "-" : undefined,
      deliveryDate: inv.ship_date ?? undefined,
    } : undefined,
  };
  void PAYMENT_CODE;
  let ii: Record<string, unknown>;
  try { ii = new SimpleInvoiceBuilder({ validationLevel: "none" }).toInvoiceInput(input) as unknown as Record<string, unknown>; }
  catch (e) { throw new EdocBuildError([libMsg(e)]); }
  overrideAmounts(ii, inv, lines);
  let xml: string;
  try { xml = new InvoiceBuilder({ validationLevel: "strict", prettyPrint: false, includeUblExtensions: true }).build(ii as never); }
  catch (e) { throw new EdocBuildError(e instanceof UblBuildError ? e.errors.map((x) => x.message) : [libMsg(e)]); }
  if (id === PLACEHOLDER(year)) xml = xml.replace(`<cbc:ID>${id}</cbc:ID>`, opts.emptyId ? "<cbc:ID></cbc:ID>" : `<cbc:ID>TASLAK${inv.no}</cbc:ID>`);
  return xml;
}

const libMsg = (e: unknown) => (e instanceof UblBuildError ? e.errors.map((x) => x.message).join(" • ") : (e as Error).message);

type Sub = { taxableAmount: number; taxAmount: number; percent: number; taxTypeCode: string; taxTypeName: string; taxExemptionReasonCode?: string; taxExemptionReason?: string };
type LibLine = { lineExtensionAmount: number; allowanceCharges?: Array<{ amount: number; baseAmount?: number }>; taxTotal: { taxAmount: number; taxSubtotals: Sub[] }; withholdingTaxTotal?: { taxAmount: number; taxSubtotals: Sub[] } };

/** Tutarları ERP'nin kuruş değerleriyle yazar (kütüphane ondalıklı hesaplar; yuvarlama farkı olmasın) */
function overrideAmounts(ii: Record<string, unknown>, inv: Invoice, lines: InvLine[]) {
  const ll = ii.lines as LibLine[];
  const reason = new Map<string, string>();
  ll.forEach((L, i) => {
    const l = lines[i]!;
    L.lineExtensionAmount = m(l.net);
    if (L.allowanceCharges?.[0]) { L.allowanceCharges[0].amount = m(l.discount); L.allowanceCharges[0].baseAmount = m(l.gross); }
    L.taxTotal.taxAmount = m(l.vat);
    const s0 = L.taxTotal.taxSubtotals[0];
    if (s0) { s0.taxableAmount = m(l.net); s0.taxAmount = m(l.vat); if (s0.taxExemptionReasonCode && s0.taxExemptionReason) reason.set(s0.taxExemptionReasonCode, s0.taxExemptionReason); }
    if (L.withholdingTaxTotal) {
      L.withholdingTaxTotal.taxAmount = m(l.withholding);
      const w0 = L.withholdingTaxTotal.taxSubtotals[0];
      if (w0) { w0.taxableAmount = m(l.vat); w0.taxAmount = m(l.withholding); }
    }
  });
  // belge KDV toplamı: oran + istisna koduna göre
  const by = new Map<string, Sub>();
  for (const l of lines) {
    const zero = Number(l.vat_rate) === 0;
    const code = zero ? l.vat_exemption_code ?? "351" : undefined;
    const k = `${l.vat_rate}|${code ?? ""}`;
    const b = by.get(k) ?? { taxableAmount: 0, taxAmount: 0, percent: Number(l.vat_rate), taxTypeCode: "0015", taxTypeName: "KDV", ...(code ? { taxExemptionReasonCode: code, taxExemptionReason: reason.get(code) ?? EXEMPTION_TEXT[code] ?? "Diğer" } : {}) };
    b.taxableAmount += Number(l.net); b.taxAmount += Number(l.vat);
    by.set(k, b);
  }
  ii.taxTotals = [{ taxAmount: m(inv.vat_total), taxSubtotals: [...by.values()].map((x) => ({ ...x, taxableAmount: m(x.taxableAmount), taxAmount: m(x.taxAmount) })) }];
  if (Array.isArray(ii.withholdingTaxTotals) && (ii.withholdingTaxTotals as unknown[]).length) {
    const names = new Map<string, string>();
    for (const L of ll) for (const w of L.withholdingTaxTotal?.taxSubtotals ?? []) names.set(w.taxTypeCode, w.taxTypeName);
    const wb = new Map<string, Sub>();
    for (const l of lines.filter((x) => Number(x.withholding) > 0)) {
      const code = l.withholding_code ?? "616";
      const k = `${code}|${l.withholding_rate}`;
      const b = wb.get(k) ?? { taxableAmount: 0, taxAmount: 0, percent: Number(l.withholding_rate), taxTypeCode: code, taxTypeName: names.get(code) ?? WITHHOLDINGS.find((w) => w[0] === code)?.[1] ?? "KDV Tevkifat" };
      b.taxableAmount += Number(l.vat); b.taxAmount += Number(l.withholding);
      wb.set(k, b);
    }
    ii.withholdingTaxTotals = [{ taxAmount: m(inv.withholding_total), taxSubtotals: [...wb.values()].map((x) => ({ ...x, taxableAmount: m(x.taxableAmount), taxAmount: m(x.taxAmount) })) }];
  }
  const lmt = (ii.legalMonetaryTotal ?? {}) as Record<string, number>;
  lmt.lineExtensionAmount = m(inv.subtotal);
  lmt.taxExclusiveAmount = m(inv.subtotal);
  lmt.taxInclusiveAmount = m(Number(inv.subtotal) + Number(inv.vat_total));
  lmt.allowanceTotalAmount = m(inv.discount_total);
  lmt.payableAmount = m(inv.total);
  ii.legalMonetaryTotal = lmt;
}

/** e-İrsaliye → UBL-TR DespatchAdvice XML */
export function buildDespatch(d: Despatch, lines: DespatchLine[], co: Company, opts: { emptyId?: boolean } = {}): string {
  const year = d.issue_date.slice(0, 4);
  const id = opts.emptyId || !d.doc_no ? PLACEHOLDER(year) : d.doc_no;
  const parts = (d.driver_name ?? "").trim().split(/\s+/);
  const family = parts.length > 1 ? parts.pop()! : d.driver_name ?? "";
  const first = parts.length ? parts.join(" ") : d.driver_name ?? "";
  const input: SimpleDespatchInput = {
    sender: senderOf(co),
    customer: { taxNumber: digits(d.party_tax_no), name: d.party_name, taxOffice: d.party_tax_office ?? undefined, address: d.party_address || "-", district: d.party_district || d.party_city || "-", city: d.party_city || "-", country: countryName(d.party_country), email: d.party_email || undefined },
    shipment: {
      actualDespatchDatetime: `${d.ship_date}T${(d.ship_time ?? d.issue_time ?? "12:00:00").slice(0, 8)}`,
      deliveryAddress: { address: d.delivery_address || d.party_address || "-", district: d.party_district || d.party_city || "-", city: d.party_city || "-", country: countryName(d.party_country), zipCode: postalOf(d.party_city, co.postal_code) },
      drivers: d.driver_name ? [{ firstName: first, familyName: family, nationalityId: digits(d.driver_tckn) }] : undefined,
      carrier: d.carrier_name ? { taxNumber: digits(d.carrier_tax_no), name: d.carrier_name, address: "-", district: "-", city: "-" } : undefined,
      licensePlates: d.plate ? [{ value: d.plate.replace(/\s/g, "").toUpperCase() }] : undefined,
      trailerPlates: d.trailer_plate ? [{ value: d.trailer_plate.replace(/\s/g, "").toUpperCase() }] : undefined,
      goodsValue: lines.some((l) => l.unit_price != null) ? lines.reduce((t, l) => t + Math.round(Number(l.unit_price ?? 0) * Number(l.qty) * 100), 0) / 100 : undefined,
      goodsValueCurrency: lines.find((l) => l.currency)?.currency ?? undefined,
    },
    lines: lines.map((l) => ({ name: l.name, quantity: Number(l.qty), unitCode: UNIT_CODE[l.unit] ?? "C62", note: l.seller_code ? `Kod: ${l.seller_code}` : undefined })),
    id, uuid: d.ettn, datetime: `${d.issue_date}T${(d.issue_time ?? "12:00:00").slice(0, 8)}`, type: d.type_code,
    notes: d.note ? [d.note] : undefined,
    orderReferences: d.order_no ? [{ id: d.order_no, issueDate: d.order_date ?? d.issue_date }] : undefined,
    additionalDocuments: d.type_code === "MATBUDAN" && d.matbu_no ? [{ id: d.matbu_no, issueDate: d.matbu_date ?? d.issue_date }] : undefined,
  };
  let xml: string;
  try { xml = new DespatchBuilder({ validationLevel: "strict", prettyPrint: false, includeUblExtensions: true }).build(mapSimpleToDespatchInput(input)); }
  catch (e) { throw new EdocBuildError(e instanceof UblBuildError ? e.errors.map((x) => x.message) : [libMsg(e)]); }
  if (id === PLACEHOLDER(year)) xml = xml.replace(`<cbc:ID>${id}</cbc:ID>`, opts.emptyId ? "<cbc:ID></cbc:ID>" : "<cbc:ID>TASLAK</cbc:ID>");
  return xml;
}
