/** UBL-TR 1.2 e-fatura: içe aktarma ayrıştırıcısı (üretim: ubl-build.ts) */
import { XMLParser } from "fast-xml-parser";
import { CODE_UNIT } from "@/lib/invoice";

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
