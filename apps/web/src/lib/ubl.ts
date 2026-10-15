/** UBL-TR 1.2 e-fatura: XML üretimi (imzasız; entegratör imzalar) ve içe aktarma ayrıştırıcısı */
import { XMLParser } from "fast-xml-parser";
import { CODE_UNIT, UNIT_CODE, type Company, type InvLine, type Invoice } from "@/lib/invoice";

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const money = (minor: number) => (Math.round(Number(minor)) / 100).toFixed(2);
const num = (v: number, d = 4) => String(Math.round(Number(v) * 10 ** d) / 10 ** d);
const el = (tag: string, value: unknown, attrs = "") => (value === null || value === undefined || value === "" ? "" : `<${tag}${attrs}>${esc(value)}</${tag}>`);

type PartyInfo = { name: string; taxNo: string | null; taxOffice: string | null; address: string | null; district: string | null; city: string | null; postal?: string | null; country: string | null; phone?: string | null; email?: string | null; website?: string | null; mersis?: string | null; registry?: string | null };

function partyXml(p: PartyInfo) {
  const tax = (p.taxNo ?? "").replace(/\D/g, "");
  const isPerson = tax.length === 11 || tax.length === 0;
  const parts = p.name.trim().split(/\s+/);
  const family = parts.length > 1 ? parts.pop()! : p.name;
  const first = parts.length ? parts.join(" ") : p.name;
  return [
    "<cac:Party>",
    el("cbc:WebsiteURI", p.website),
    `<cac:PartyIdentification><cbc:ID schemeID="${isPerson ? "TCKN" : "VKN"}">${esc(tax || "11111111111")}</cbc:ID></cac:PartyIdentification>`,
    p.mersis ? `<cac:PartyIdentification><cbc:ID schemeID="MERSISNO">${esc(p.mersis)}</cbc:ID></cac:PartyIdentification>` : "",
    p.registry ? `<cac:PartyIdentification><cbc:ID schemeID="TICARETSICILNO">${esc(p.registry)}</cbc:ID></cac:PartyIdentification>` : "",
    isPerson ? "" : `<cac:PartyName>${el("cbc:Name", p.name)}</cac:PartyName>`,
    "<cac:PostalAddress>",
    el("cbc:StreetName", p.address || "-"),
    el("cbc:CitySubdivisionName", p.district || p.city || "-"),
    el("cbc:CityName", p.city || "-"),
    el("cbc:PostalZone", p.postal),
    `<cac:Country>${el("cbc:Name", !p.country || p.country === "TR" ? "Türkiye" : p.country)}</cac:Country>`,
    "</cac:PostalAddress>",
    p.taxOffice ? `<cac:PartyTaxScheme><cac:TaxScheme>${el("cbc:Name", p.taxOffice)}</cac:TaxScheme></cac:PartyTaxScheme>` : "",
    p.phone || p.email ? `<cac:Contact>${el("cbc:Telephone", p.phone)}${el("cbc:ElectronicMail", p.email)}</cac:Contact>` : "",
    isPerson ? `<cac:Person>${el("cbc:FirstName", first)}${el("cbc:FamilyName", family)}</cac:Person>` : "",
    "</cac:Party>",
  ].join("");
}

function taxSubtotal(cur: string, base: number, vat: number, rate: number, exemption?: string | null) {
  const ex = rate === 0 ? `${el("cbc:TaxExemptionReasonCode", exemption || "351")}${el("cbc:TaxExemptionReason", exemption === "301" ? "11/1-a Mal ihracatı" : exemption === "302" ? "11/1-a Hizmet ihracatı" : "Diğer")}` : "";
  return `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${cur}">${money(base)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${cur}">${money(vat)}</cbc:TaxAmount><cbc:Percent>${num(rate, 2)}</cbc:Percent><cac:TaxCategory>${ex}<cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`;
}

/** Satış faturası → UBL-TR XML */
export function buildUbl(inv: Invoice, lines: InvLine[], co: Company, opts: { returnOf?: { doc_no: string; date: string } | null } = {}): string {
  const cur = inv.currency;
  const withholding = Number(inv.withholding_total) > 0;
  const typeCode = inv.type === "return" ? "IADE" : withholding ? "TEVKIFAT" : inv.profile === "IHRACAT" ? "ISTISNA" : "SATIS";
  const profile = inv.profile === "KAGIT" ? "TICARIFATURA" : inv.type === "return" && inv.profile === "TICARIFATURA" ? "TEMELFATURA" : inv.profile;
  const byRate = new Map<string, { base: number; vat: number; rate: number; ex: string | null }>();
  for (const l of lines) {
    const k = `${l.vat_rate}|${l.vat_rate === 0 ? l.vat_exemption_code ?? "351" : ""}`;
    const b = byRate.get(k) ?? { base: 0, vat: 0, rate: Number(l.vat_rate), ex: l.vat_exemption_code ?? null };
    byRate.set(k, { ...b, base: b.base + Number(l.net), vat: b.vat + Number(l.vat) });
  }
  const supplier: PartyInfo = { name: co.name, taxNo: co.tax_no, taxOffice: co.tax_office, address: co.address, district: co.district, city: co.city, postal: co.postal_code, country: co.country, phone: co.phone, email: co.email, website: co.website, mersis: co.mersis_no, registry: co.trade_registry_no };
  const customer: PartyInfo = { name: inv.party_name ?? "", taxNo: inv.party_tax_no, taxOffice: inv.party_tax_office, address: inv.party_address, district: inv.party_district, city: inv.party_city, country: inv.party_country, email: inv.party_email };
  const notes = [inv.note, co.inv_note, Number(inv.withholding_total) > 0 ? "KDV tevkifatlı fatura" : null].filter(Boolean) as string[];

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">`,
    `<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>`,
    `<cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:CustomizationID>TR1.2</cbc:CustomizationID>`,
    el("cbc:ProfileID", profile),
    el("cbc:ID", inv.doc_no ?? `TASLAK${inv.no}`),
    `<cbc:CopyIndicator>false</cbc:CopyIndicator>`,
    el("cbc:UUID", inv.ettn),
    el("cbc:IssueDate", inv.invoice_date),
    el("cbc:IssueTime", (inv.invoice_time ?? "12:00:00").slice(0, 8)),
    el("cbc:InvoiceTypeCode", typeCode),
    ...notes.map((n) => el("cbc:Note", n)),
    el("cbc:DocumentCurrencyCode", cur),
    el("cbc:LineCountNumeric", lines.length),
    opts.returnOf ? `<cac:BillingReference><cac:InvoiceDocumentReference>${el("cbc:ID", opts.returnOf.doc_no)}${el("cbc:IssueDate", opts.returnOf.date)}</cac:InvoiceDocumentReference></cac:BillingReference>` : "",
    `<cac:AccountingSupplierParty>${partyXml(supplier)}</cac:AccountingSupplierParty>`,
    `<cac:AccountingCustomerParty>${partyXml(customer)}</cac:AccountingCustomerParty>`,
    inv.due_date ? `<cac:PaymentMeans><cbc:PaymentMeansCode>ZZZ</cbc:PaymentMeansCode>${el("cbc:PaymentDueDate", inv.due_date)}</cac:PaymentMeans>` : "",
    cur !== "TRY" ? `<cac:PricingExchangeRate><cbc:SourceCurrencyCode>${cur}</cbc:SourceCurrencyCode><cbc:TargetCurrencyCode>TRY</cbc:TargetCurrencyCode><cbc:CalculationRate>${num(inv.rate, 6)}</cbc:CalculationRate></cac:PricingExchangeRate>` : "",
    `<cac:TaxTotal><cbc:TaxAmount currencyID="${cur}">${money(inv.vat_total)}</cbc:TaxAmount>${[...byRate.values()].map((r) => taxSubtotal(cur, r.base, r.vat, r.rate, r.ex)).join("")}</cac:TaxTotal>`,
    withholding ? withholdingTotal(cur, lines) : "",
    `<cac:LegalMonetaryTotal>`,
    `<cbc:LineExtensionAmount currencyID="${cur}">${money(inv.subtotal)}</cbc:LineExtensionAmount>`,
    `<cbc:TaxExclusiveAmount currencyID="${cur}">${money(inv.subtotal)}</cbc:TaxExclusiveAmount>`,
    `<cbc:TaxInclusiveAmount currencyID="${cur}">${money(Number(inv.subtotal) + Number(inv.vat_total))}</cbc:TaxInclusiveAmount>`,
    `<cbc:AllowanceTotalAmount currencyID="${cur}">${money(inv.discount_total)}</cbc:AllowanceTotalAmount>`,
    `<cbc:PayableAmount currencyID="${cur}">${money(inv.total)}</cbc:PayableAmount>`,
    `</cac:LegalMonetaryTotal>`,
    ...lines.map((l, i) => lineXml(cur, l, i + 1)),
    `</Invoice>`,
  ];
  return xml.filter(Boolean).join("\n");
}

function withholdingTotal(cur: string, lines: InvLine[]) {
  const by = new Map<string, { base: number; amount: number; rate: number; code: string }>();
  for (const l of lines) {
    if (!Number(l.withholding)) continue;
    const code = l.withholding_code ?? "616";
    const k = `${code}|${l.withholding_rate}`;
    const b = by.get(k) ?? { base: 0, amount: 0, rate: Number(l.withholding_rate), code };
    by.set(k, { ...b, base: b.base + Number(l.vat), amount: b.amount + Number(l.withholding) });
  }
  const total = [...by.values()].reduce((t, r) => t + r.amount, 0);
  return `<cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="${cur}">${money(total)}</cbc:TaxAmount>${[...by.values()].map((r) =>
    `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${cur}">${money(r.base)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${cur}">${money(r.amount)}</cbc:TaxAmount><cbc:Percent>${num(r.rate, 2)}</cbc:Percent><cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV TEVKIFAT</cbc:Name><cbc:TaxTypeCode>${r.code}</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`).join("")}</cac:WithholdingTaxTotal>`;
}

function lineXml(cur: string, l: InvLine, n: number) {
  const disc = Number(l.discount);
  return [
    `<cac:InvoiceLine>`,
    el("cbc:ID", n),
    `<cbc:InvoicedQuantity unitCode="${UNIT_CODE[l.unit] ?? "C62"}">${num(l.qty, 3)}</cbc:InvoicedQuantity>`,
    `<cbc:LineExtensionAmount currencyID="${cur}">${money(l.net)}</cbc:LineExtensionAmount>`,
    disc > 0 ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:MultiplierFactorNumeric>${num(Number(l.discount_pct) / 100, 6)}</cbc:MultiplierFactorNumeric><cbc:Amount currencyID="${cur}">${money(disc)}</cbc:Amount><cbc:BaseAmount currencyID="${cur}">${money(l.gross)}</cbc:BaseAmount></cac:AllowanceCharge>` : "",
    `<cac:TaxTotal><cbc:TaxAmount currencyID="${cur}">${money(l.vat)}</cbc:TaxAmount>${taxSubtotal(cur, Number(l.net), Number(l.vat), Number(l.vat_rate), l.vat_exemption_code)}</cac:TaxTotal>`,
    Number(l.withholding) > 0 ? `<cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="${cur}">${money(l.withholding)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="${cur}">${money(l.vat)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${cur}">${money(l.withholding)}</cbc:TaxAmount><cbc:Percent>${num(Number(l.withholding_rate), 2)}</cbc:Percent><cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV TEVKIFAT</cbc:Name><cbc:TaxTypeCode>${l.withholding_code ?? "616"}</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:WithholdingTaxTotal>` : "",
    `<cac:Item>${el("cbc:Name", l.name)}${l.seller_code ? `<cac:SellersItemIdentification>${el("cbc:ID", l.seller_code)}</cac:SellersItemIdentification>` : ""}</cac:Item>`,
    `<cac:Price><cbc:PriceAmount currencyID="${cur}">${num(l.unit_price, 4)}</cbc:PriceAmount></cac:Price>`,
    `</cac:InvoiceLine>`,
  ].join("");
}

// ---------------------------------------------------------------------
// İçe aktarma
// ---------------------------------------------------------------------
export type ParsedParty = { name: string; tax_no: string | null; tax_office: string | null; address: string | null; district: string | null; city: string | null; country: string | null; email: string | null; phone: string | null; website: string | null };
export type ParsedLine = { name: string; seller_code: string | null; qty: number; unit: string; unit_price: number; discount_pct: number; vat_rate: number; withholding_rate: number; withholding_code: string | null; vat_exemption_code: string | null; net: number };
export type ParsedInvoice = {
  doc_no: string; ettn: string | null; date: string; time: string | null; profile: string; type_code: string; currency: string; rate: number | null;
  supplier: ParsedParty; customer: ParsedParty; lines: ParsedLine[]; notes: string[];
  payable: number; vat_total: number; withholding_total: number; due_date: string | null;
};

const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true, parseTagValue: false, trimValues: true,
  isArray: (name) => ["InvoiceLine", "TaxSubtotal", "PartyIdentification", "Note", "AllowanceCharge", "WithholdingTaxTotal", "TaxTotal"].includes(name),
});

type X = Record<string, unknown>;
const obj = (v: unknown): X => (v && typeof v === "object" && !Array.isArray(v) ? (v as X) : Array.isArray(v) && v[0] && typeof v[0] === "object" ? (v[0] as X) : {});
const arr = (v: unknown): X[] => (Array.isArray(v) ? (v as X[]) : v ? [v as X] : []);
const txt = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return txt((v as X)["#text"] ?? "");
  return String(v).trim();
};
const n = (v: unknown) => { const x = Number(txt(v).replace(",", ".")); return Number.isFinite(x) ? x : 0; };
const minor = (v: unknown) => Math.round(n(v) * 100);

/** XML içinde "Invoice" düğümünü bul (zarf / StandardBusinessDocument içinde olabilir) */
function findInvoice(node: unknown, depth = 0): X | null {
  if (!node || typeof node !== "object" || depth > 8) return null;
  const o = node as X;
  if (o.Invoice && typeof o.Invoice === "object") return obj(o.Invoice);
  for (const v of Object.values(o)) {
    for (const c of Array.isArray(v) ? v : [v]) { const r = findInvoice(c, depth + 1); if (r) return r; }
  }
  return null;
}

function parseParty(p: X): ParsedParty {
  const party = obj(p.Party);
  const ids = arr(party.PartyIdentification).map((i) => obj(i).ID);
  let tax: string | null = null;
  for (const id of ids) {
    const scheme = typeof id === "object" ? String((id as X)["@_schemeID"] ?? "") : "";
    if (scheme === "VKN" || scheme === "TCKN") { tax = txt(id).replace(/\D/g, ""); break; }
  }
  const person = obj(party.Person);
  const personName = [txt(person.FirstName), txt(person.MiddleName), txt(person.FamilyName)].filter(Boolean).join(" ");
  const addr = obj(party.PostalAddress);
  const street = [txt(addr.StreetName), txt(addr.BuildingName), txt(addr.BuildingNumber) && `No:${txt(addr.BuildingNumber)}`, txt(addr.Room) && `D:${txt(addr.Room)}`].filter(Boolean).join(" ");
  const contact = obj(party.Contact);
  return {
    name: txt(obj(party.PartyName).Name) || personName || txt(obj(party.PartyLegalEntity).RegistrationName) || "Adsız cari",
    tax_no: tax && (tax.length === 10 || tax.length === 11) ? tax : null,
    tax_office: txt(obj(obj(party.PartyTaxScheme).TaxScheme).Name) || null,
    address: street || null,
    district: txt(addr.CitySubdivisionName) || null,
    city: txt(addr.CityName) || null,
    country: txt(obj(addr.Country).Name) || null,
    email: txt(contact.ElectronicMail) || null,
    phone: txt(contact.Telephone) || null,
    website: txt(party.WebsiteURI) || null,
  };
}

export function parseUbl(xml: string): ParsedInvoice {
  const doc = parser.parse(xml);
  const inv = findInvoice(doc);
  if (!inv) throw new Error("Bu dosya UBL e-fatura değil (Invoice bulunamadı).");
  const lines: ParsedLine[] = arr(inv.InvoiceLine).map((raw) => {
    const l = obj(raw);
    const q = obj(l.InvoicedQuantity);
    const qty = n(l.InvoicedQuantity) || 1;
    const price = n(obj(l.Price).PriceAmount);
    const gross = qty * price;
    const allowance = arr(l.AllowanceCharge).filter((a) => txt(obj(a).ChargeIndicator) !== "true").reduce((t, a) => t + n(obj(a).Amount), 0);
    const vatSub = arr(obj(arr(l.TaxTotal)[0]).TaxSubtotal).map(obj).find((s) => txt(obj(obj(s.TaxCategory).TaxScheme).TaxTypeCode) === "0015") ?? obj(arr(obj(arr(l.TaxTotal)[0]).TaxSubtotal)[0]);
    const whSub = obj(arr(obj(arr(l.WithholdingTaxTotal)[0]).TaxSubtotal)[0]);
    const item = obj(l.Item);
    return {
      name: (txt(item.Name) || txt(item.Description) || "Kalem").slice(0, 300),
      seller_code: txt(obj(item.SellersItemIdentification).ID) || txt(obj(item.ManufacturersItemIdentification).ID) || null,
      qty,
      unit: CODE_UNIT[String(q["@_unitCode"] ?? "")] ?? "adet",
      unit_price: price,
      discount_pct: gross > 0 && allowance > 0 ? Math.min(100, Math.round((allowance / gross) * 100 * 10000) / 10000) : 0,
      vat_rate: n(vatSub.Percent),
      withholding_rate: n(whSub.Percent),
      withholding_code: txt(obj(obj(whSub.TaxCategory).TaxScheme).TaxTypeCode) || null,
      vat_exemption_code: txt(obj(vatSub.TaxCategory).TaxExemptionReasonCode) || null,
      net: minor(l.LineExtensionAmount),
    };
  });
  const mt = obj(inv.LegalMonetaryTotal);
  return {
    doc_no: txt(inv.ID),
    ettn: txt(inv.UUID) || null,
    date: txt(inv.IssueDate),
    time: txt(inv.IssueTime) || null,
    profile: txt(inv.ProfileID) || "TICARIFATURA",
    type_code: txt(inv.InvoiceTypeCode) || "SATIS",
    currency: txt(inv.DocumentCurrencyCode) || "TRY",
    rate: n(obj(inv.PricingExchangeRate).CalculationRate) || null,
    supplier: parseParty(obj(inv.AccountingSupplierParty)),
    customer: parseParty(obj(inv.AccountingCustomerParty)),
    lines,
    notes: arr(inv.Note).map((x) => txt(x)).filter(Boolean),
    payable: minor(mt.PayableAmount),
    vat_total: arr(inv.TaxTotal).reduce((t, x) => t + minor(obj(x).TaxAmount), 0),
    withholding_total: arr(inv.WithholdingTaxTotal).reduce((t, x) => t + minor(obj(x).TaxAmount), 0),
    due_date: txt(obj(inv.PaymentMeans).PaymentDueDate) || null,
  };
}

export type ParsedDespatch = {
  doc_no: string; ettn: string | null; date: string; profile: string; type_code: string; supplier: ParsedParty; customer: ParsedParty;
  lines: Array<{ name: string; seller_code: string | null; qty: number; unit: string }>; notes: string[]; ship_date: string | null;
};

function findNode(node: unknown, key: string, depth = 0): X | null {
  if (!node || typeof node !== "object" || depth > 8) return null;
  const o = node as X;
  if (o[key] && typeof o[key] === "object") return obj(o[key]);
  for (const v of Object.values(o)) for (const c of Array.isArray(v) ? v : [v]) { const r = findNode(c, key, depth + 1); if (r) return r; }
  return null;
}

/** UBL-TR e-İrsaliye (DespatchAdvice) ayrıştırıcısı */
export function parseDespatch(xml: string): ParsedDespatch {
  const d = findNode(parser.parse(xml), "DespatchAdvice");
  if (!d) throw new Error("Bu dosya e-irsaliye değil (DespatchAdvice bulunamadı).");
  const ship = obj(d.Shipment);
  return {
    doc_no: txt(d.ID),
    ettn: txt(d.UUID) || null,
    date: txt(d.IssueDate),
    profile: txt(d.ProfileID) || "TEMELIRSALIYE",
    type_code: txt(d.DespatchAdviceTypeCode) || "SEVK",
    supplier: parseParty(obj(d.DespatchSupplierParty)),
    customer: parseParty(obj(d.DeliveryCustomerParty)),
    lines: arr(d.DespatchLine).map((raw) => {
      const l = obj(raw);
      const q = obj(l.DeliveredQuantity);
      const item = obj(l.Item);
      return {
        name: (txt(item.Name) || txt(item.Description) || "Kalem").slice(0, 300),
        seller_code: txt(obj(item.SellersItemIdentification).ID) || null,
        qty: n(l.DeliveredQuantity) || 1,
        unit: CODE_UNIT[String(q["@_unitCode"] ?? "")] ?? "adet",
      };
    }),
    notes: arr(d.Note).map((x) => txt(x)).filter(Boolean),
    ship_date: txt(obj(obj(ship.Delivery).Despatch).ActualDespatchDate) || null,
  };
}

/** XML hangi e-belge: fatura mı irsaliye mi */
export const ublKind = (xml: string): "invoice" | "despatch" | null => (/<(\w+:)?DespatchAdvice[\s>]/.test(xml) ? "despatch" : /<(\w+:)?Invoice[\s>]/.test(xml) ? "invoice" : null);
