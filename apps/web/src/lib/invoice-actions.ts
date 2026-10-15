"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { CURRENCIES, dateOk, parseRate } from "@/lib/fin";
import { DIRECTION, invError, type Direction, type LineInput } from "@/lib/invoice";
import type { ParsedInvoice, ParsedParty } from "@/lib/ubl";
import { elogoConfigured } from "@/lib/elogo";
import { checkParties } from "@/lib/einv-send";

const str = (f: FormData, k: string, max = 400) => String(f.get(k) ?? "").trim().slice(0, max);
const dirOf = (v: unknown): Direction => (v === "purchase" ? "purchase" : "sale");

async function level(direction: Direction) {
  const s = await getSession();
  return s.modules[DIRECTION[direction].module] ?? 0;
}

function revalidate(direction: Direction, id?: string) {
  revalidatePath(DIRECTION[direction].base, "layout");
  if (id) revalidatePath(`/fatura/${id}`);
  revalidatePath("/finans", "layout");
  revalidatePath("/stok", "layout");
}

export type InvoicePayload = {
  id?: string | null; direction: Direction; type: "invoice" | "return"; party_id?: string | null;
  new_party?: { name: string; tax_no?: string; tax_office?: string; address?: string; city?: string; email?: string; phone?: string; is_einvoice?: boolean } | null;
  doc_no?: string | null; invoice_date: string; due_date?: string | null; currency: string; rate?: string | null; warehouse_id?: string | null; profile?: string | null;
  note?: string | null; lines: LineInput[]; post?: boolean; return_of?: string | null;
  edoc?: Record<string, string | number | boolean | null> | null;
  ettn?: string | null;
};

/** Fatura formu: taslak kaydet (+ isteğe bağlı işle). Cari yoksa VKN ile açar. */
export async function saveInvoice(p: InvoicePayload): Promise<{ ok: boolean; id?: string; message: string }> {
  const direction = dirOf(p.direction);
  if ((await level(direction)) < 2) return { ok: false, message: invError("not_allowed") };
  const supabase = await createClient();
  let partyId = p.party_id || null;
  if (!partyId && p.new_party?.name?.trim()) {
    const { data, error } = await supabase.rpc("fin_party_ensure", { p: { ...p.new_party, source: "manual" }, p_role: direction === "sale" ? "customer" : "supplier" });
    if (error) return { ok: false, message: invError(error.message) };
    partyId = data as string;
  }
  if (!partyId) return { ok: false, message: "Cari seçin ya da yeni cari bilgilerini yazın." };
  // kesmeden önce alıcının GİB mükellefiyeti (e-Fatura / e-Arşiv kararı için) — eLogo bağlıysa, 7 günde bir
  const issuing = (direction === "sale" && p.type !== "return") || (direction === "purchase" && p.type === "return");
  if (p.post && issuing && !p.profile && elogoConfigured()) {
    const { data: pt } = await supabase.from("fin_parties").select("id, tax_no, country, gib_checked_at").eq("id", partyId).maybeSingle();
    if (pt?.tax_no && (!pt.gib_checked_at || Date.now() - new Date(pt.gib_checked_at as string).getTime() > 7 * 86400000)) {
      try { await checkParties(supabase, [pt as { id: string; tax_no: string; country: string }]); } catch { /* sorgu yapılamazsa kayıtlı bilgi kullanılır */ }
    }
  }
  const lines = (p.lines ?? []).filter((l) => l.name?.trim() && Number(l.qty) > 0).slice(0, 500);
  if (!lines.length) return { ok: false, message: "En az bir satır girin." };
  const currency = (CURRENCIES as readonly string[]).includes(p.currency) ? p.currency : "TRY";
  const body = {
    id: p.id || null, direction, type: p.type === "return" ? "return" : "invoice", party_id: partyId,
    doc_no: p.doc_no?.trim() || null, invoice_date: dateOk(p.invoice_date) ?? undefined, due_date: dateOk(p.due_date) ?? null,
    currency, rate: currency === "TRY" ? 1 : parseRate(p.rate) ?? null, warehouse_id: p.warehouse_id || null, profile: p.profile || null,
    note: p.note?.slice(0, 1000) || null, return_of: p.return_of || null,
    ettn: p.ettn && /^[0-9a-f-]{36}$/i.test(p.ettn) && !p.id ? p.ettn : null,
    lines: lines.map((l) => ({
      item_id: l.item_id || null, lab_product_id: l.lab_product_id || null, category_id: l.category_id || null, job_id: l.job_id || null,
      name: l.name.slice(0, 300), seller_code: l.seller_code || null, qty: Number(l.qty), unit: l.unit || "adet", unit_price: Number(l.unit_price) || 0,
      discount_pct: Number(l.discount_pct) || 0, vat_rate: Number(l.vat_rate) || 0, withholding_rate: Number(l.withholding_rate) || 0,
      withholding_code: l.withholding_code || null, vat_exemption_code: l.vat_exemption_code || null, lot_no: l.lot_no || null, expiry_date: dateOk(l.expiry_date) ?? null,
      gtip: l.gtip || null, ident_scheme: l.ident_scheme || null, ident: l.ident || null, diib_line: l.diib_line || null,
    })),
  };
  const { data: id, error } = await supabase.rpc("inv_save", { p: body });
  if (error) return { ok: false, message: invError(error.message) };
  if (p.edoc && Object.keys(p.edoc).length) {
    const { error: ee } = await supabase.rpc("inv_set_edoc", { p_id: id, p: p.edoc });
    if (ee && !/function|schema cache/.test(ee.message)) return { ok: false, id: id as string, message: `Taslak kaydedildi ama e-belge bilgileri kaydedilemedi: ${invError(ee.message)}` };
  }
  if (p.post) {
    const { error: pe } = await supabase.rpc("inv_post", { p_id: id });
    revalidate(direction, id as string);
    if (pe) return { ok: false, id: id as string, message: `Taslak kaydedildi ama işlenemedi: ${invError(pe.message)}` };
    return { ok: true, id: id as string, message: "Fatura kesildi; cari, KDV ve stok işlendi." };
  }
  revalidate(direction, id as string);
  return { ok: true, id: id as string, message: "Taslak kaydedildi." };
}

export async function postInvoice(form: FormData) {
  const id = str(form, "id", 40);
  const direction = dirOf(str(form, "direction"));
  if ((await level(direction)) < 2) await fail(invError("not_allowed"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("inv_post", { p_id: id });
  if (error) await fail(invError(error.message));
  revalidate(direction, id);
  await done("Fatura işlendi.");
}

export async function cancelInvoice(form: FormData) {
  const id = str(form, "id", 40);
  const direction = dirOf(str(form, "direction"));
  if ((await level(direction)) < 3) await fail(invError("not_allowed"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("inv_cancel", { p_id: id, p_reason: str(form, "reason", 300) || "İptal" });
  if (error) await fail(invError(error.message));
  revalidate(direction, id);
  await done("Fatura iptal edildi; cari, KDV ve stok geri alındı.");
}

export async function deleteInvoice(form: FormData) {
  const id = str(form, "id", 40);
  const direction = dirOf(str(form, "direction"));
  if ((await level(direction)) < 2) await fail(invError("not_allowed"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("inv_delete", { p_id: id });
  if (error) await fail(invError(error.message));
  revalidate(direction);
  redirect(`${DIRECTION[direction].base}/faturalar?tamam=${encodeURIComponent("Taslak silindi.")}`);
}

export async function setEinvoiceStatus(form: FormData) {
  const id = str(form, "id", 40);
  const direction = dirOf(str(form, "direction"));
  if ((await level(direction)) < 2) await fail(invError("not_allowed"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("inv_set_einvoice", { p_id: id, p_status: str(form, "status", 20), p_note: str(form, "note", 500), p_doc_no: str(form, "doc_no", 40) || null });
  if (error) await fail(invError(error.message));
  revalidate(direction, id);
  await done("e-Fatura durumu güncellendi.");
}

/** Toplu e-fatura durumu (gönderildi işaretle) */
export async function bulkEinvoice(form: FormData) {
  if ((await level("sale")) < 2) await fail(invError("not_allowed"));
  const ids = form.getAll("ids").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
  if (!ids.length) await fail("Fatura seçin.");
  const supabase = await createClient();
  for (const id of ids) {
    const { error } = await supabase.rpc("inv_set_einvoice", { p_id: id, p_status: str(form, "status", 20) || "sent", p_note: null });
    if (error) await fail(invError(error.message));
  }
  revalidate("sale");
  await done(`${ids.length} fatura güncellendi.`);
}

export async function invoiceFromJobs(form: FormData) {
  if ((await level("sale")) < 2) await fail(invError("not_allowed"));
  const ids = form.getAll("job").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 300);
  if (!ids.length) await fail("Faturalanacak işleri seçin.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_from_jobs", { p_jobs: ids });
  if (error) await fail(invError(error.message));
  revalidate("sale");
  redirect(`/fatura/${data}?tamam=${encodeURIComponent("İşlerden fatura taslağı hazırlandı; kontrol edip “Faturayı kes” deyin.")}`);
}

export async function saveInvoiceSettings(form: FormData) {
  const s = await getSession();
  if (s.role !== "owner") await fail("Şirket fatura bilgilerini yalnız firma sahibi değiştirebilir.");
  const supabase = await createClient();
  const prefix = (k: string, d: string) => (/^[A-Z0-9]{3}$/.test(str(form, k, 3).toUpperCase()) ? str(form, k, 3).toUpperCase() : d);
  const tax = str(form, "tax_no", 11).replace(/\D/g, "");
  const row = {
    name: str(form, "name", 200) || undefined,
    tax_no: tax || null, tax_office: str(form, "tax_office", 80) || null, address: str(form, "address", 400) || null, district: str(form, "district", 80) || null,
    city: str(form, "city", 80) || null, postal_code: str(form, "postal_code", 10) || null, country: str(form, "country", 60) || "Türkiye", phone: str(form, "phone", 40) || null,
    email: str(form, "email", 200) || null, website: str(form, "website", 200) || null, mersis_no: str(form, "mersis_no", 20) || null, trade_registry_no: str(form, "trade_registry_no", 30) || null,
    inv_prefix_efatura: prefix("inv_prefix_efatura", "MBD"), inv_prefix_earsiv: prefix("inv_prefix_earsiv", "MBA"),
    inv_lab_vat: Math.min(100, Math.max(0, Number(str(form, "inv_lab_vat").replace(",", ".")) || 0)), inv_note: str(form, "inv_note", 1000) || null,
    einvoice_provider: str(form, "einvoice_provider", 60) || null,
  };
  const { data: co } = await supabase.from("companies").select("id").order("created_at").limit(1).maybeSingle();
  const { error } = await supabase.from("companies").update(row).eq("id", co?.id ?? "");
  if (error) await fail(invError(error.message));
  revalidatePath("/satis", "layout");
  await done("Fatura bilgileri kaydedildi.");
}

// ---------------------------------------------------------------------
// e-Fatura içe aktarma (XML tarayıcıda ayrıştırılır; burada eşleştirilir ve kaydedilir)
// ---------------------------------------------------------------------
export type ImportMatch = {
  key: string; direction: Direction; duplicate: string | null;
  party: { id: string; name: string } | null;
  lines: { item_id: string | null; how: "learned" | "code" | "barcode" | "name" | null }[];
};

export async function matchImports(list: { key: string; inv: ParsedInvoice }[]): Promise<{ ok: boolean; message?: string; matches?: ImportMatch[] }> {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 2 && (s.modules.sales ?? 0) < 2) return { ok: false, message: invError("not_allowed") };
  const supabase = await createClient();
  const { data: co } = await supabase.from("companies").select("tax_no").order("created_at").limit(1).maybeSingle();
  const ourTax = String(co?.tax_no ?? "").replace(/\D/g, "");
  const [{ data: items }, { data: parties }] = await Promise.all([
    supabase.from("stk_items").select("id, code, barcode, name").limit(10000),
    supabase.from("fin_parties").select("id, name, tax_no").limit(10000),
  ]);
  const byCode = new Map<string, string>(), byBarcode = new Map<string, string>(), byName = new Map<string, string>();
  for (const i of items ?? []) {
    byCode.set(String(i.code).toLocaleLowerCase("tr"), i.id as string);
    if (i.barcode) byBarcode.set(String(i.barcode), i.id as string);
    byName.set(String(i.name).toLocaleLowerCase("tr").replace(/\s+/g, " "), i.id as string);
  }
  const pByTax = new Map((parties ?? []).filter((p) => p.tax_no).map((p) => [String(p.tax_no), { id: p.id as string, name: p.name as string }]));
  const pByName = new Map((parties ?? []).map((p) => [String(p.name).toLocaleLowerCase("tr"), { id: p.id as string, name: p.name as string }]));
  const out: ImportMatch[] = [];
  for (const { key, inv } of list.slice(0, 100)) {
    const direction: Direction = ourTax && inv.supplier.tax_no === ourTax ? "sale" : "purchase";
    const other = direction === "sale" ? inv.customer : inv.supplier;
    const party = (other.tax_no && pByTax.get(other.tax_no)) || pByName.get(other.name.toLocaleLowerCase("tr")) || null;
    let duplicate: string | null = null;
    if (inv.ettn) {
      const { data: d } = await supabase.from("inv_invoices").select("id").eq("direction", direction).eq("ettn", inv.ettn).neq("status", "cancelled").limit(1).maybeSingle();
      duplicate = (d?.id as string) ?? null;
    }
    // daha önce bu tedarikçiden aynı kodla gelen kalem hangi karta bağlandıysa onu öner (öğrenen eşleştirme)
    const learned = new Map<string, string>();
    if (party) {
      const codes = inv.lines.map((l) => l.seller_code).filter(Boolean) as string[];
      const names = inv.lines.map((l) => l.name);
      const { data: prev } = await supabase.from("inv_lines").select("seller_code, name, item_id, inv_invoices!inner(party_id)").eq("inv_invoices.party_id", party.id).not("item_id", "is", null).limit(2000);
      for (const r of (prev ?? []) as unknown as { seller_code: string | null; name: string; item_id: string }[]) {
        if (r.seller_code && codes.includes(r.seller_code)) learned.set(`c:${r.seller_code}`, r.item_id);
        if (names.includes(r.name)) learned.set(`n:${r.name}`, r.item_id);
      }
    }
    out.push({
      key, direction, duplicate, party,
      lines: inv.lines.map((l) => {
        const c = l.seller_code ?? "";
        if (c && learned.get(`c:${c}`)) return { item_id: learned.get(`c:${c}`)!, how: "learned" as const };
        if (learned.get(`n:${l.name}`)) return { item_id: learned.get(`n:${l.name}`)!, how: "learned" as const };
        if (c && byBarcode.get(c)) return { item_id: byBarcode.get(c)!, how: "barcode" as const };
        if (c && byCode.get(c.toLocaleLowerCase("tr"))) return { item_id: byCode.get(c.toLocaleLowerCase("tr"))!, how: "code" as const };
        const nm = byName.get(l.name.toLocaleLowerCase("tr").replace(/\s+/g, " "));
        return nm ? { item_id: nm, how: "name" as const } : { item_id: null, how: null };
      }),
    });
  }
  return { ok: true, matches: out };
}

export type ImportCommit = {
  inv: ParsedInvoice; direction: Direction; xml: string; post: boolean; warehouse_id: string | null;
  lines: { mode: "item" | "new" | "none"; item_id?: string | null; category_id?: string | null; new_kind?: string }[];
};

function partyPayload(p: ParsedParty) {
  return { name: p.name, tax_no: p.tax_no, tax_office: p.tax_office, address: p.address, district: p.district, city: p.city, country: p.country && /türkiye|turkey|^tr$/i.test(p.country) ? "TR" : p.country, email: p.email, phone: p.phone, website: p.website, is_einvoice: true, source: "einvoice" };
}

export async function commitImport(c: ImportCommit): Promise<{ ok: boolean; id?: string; message: string }> {
  const direction = dirOf(c.direction);
  if ((await level(direction)) < 2) return { ok: false, message: invError("not_allowed") };
  const supabase = await createClient();
  const inv = c.inv;
  const other = direction === "sale" ? inv.customer : inv.supplier;
  const { data: partyId, error: pe } = await supabase.rpc("fin_party_ensure", { p: { ...partyPayload(other), currency: inv.currency }, p_role: direction === "sale" ? "customer" : "supplier" });
  if (pe) return { ok: false, message: invError(pe.message) };
  const s = await getSession();
  const canStock = (s.modules.stock ?? 0) >= 2;
  const lines = [];
  for (let i = 0; i < inv.lines.length; i++) {
    const l = inv.lines[i];
    const m = c.lines[i] ?? { mode: "none" };
    let itemId: string | null = m.mode === "item" ? m.item_id || null : null;
    if (m.mode === "new") {
      if (!canStock) return { ok: false, message: "Yeni stok kartı açmak için stok yetkisi gerekir; satırı mevcut karta bağlayın ya da “stoksuz” seçin." };
      const kind = ["material", "raw", "consumable", "goods", "packaging", "service", "product"].includes(m.new_kind ?? "") ? m.new_kind! : "material";
      const { data: code } = await supabase.rpc("stk_next_code", { p_prefix: kind === "service" ? "H" : "M" });
      const { data: item, error: ie } = await supabase.from("stk_items").insert({
        code: (code as string) || `M${Date.now().toString().slice(-6)}`, name: l.name.slice(0, 200), kind, unit: l.unit, vat_rate: l.vat_rate,
        purchase_price: Math.round(l.unit_price * 100), purchase_currency: inv.currency, supplier_party_id: direction === "purchase" ? partyId : null,
        barcode: null, note: l.seller_code ? `Tedarikçi kodu: ${l.seller_code}` : null,
      }).select("id").single();
      if (ie) return { ok: false, message: `Kart açılamadı (${l.name}): ${ie.message}` };
      itemId = item.id as string;
    }
    lines.push({
      item_id: itemId, category_id: m.mode === "none" ? m.category_id || null : null, name: l.name, seller_code: l.seller_code, qty: l.qty, unit: l.unit,
      unit_price: l.unit_price, discount_pct: l.discount_pct, vat_rate: l.vat_rate, withholding_rate: l.withholding_rate, withholding_code: l.withholding_code, vat_exemption_code: l.vat_exemption_code,
    });
  }
  const xml = c.xml.replace(/<(\w+:)?EmbeddedDocumentBinaryObject[^>]*>[\s\S]*?<\/(\w+:)?EmbeddedDocumentBinaryObject>/g, "").slice(0, 2_500_000);
  const profile = ["TEMELFATURA", "TICARIFATURA", "EARSIVFATURA", "IHRACAT"].includes(inv.profile) ? inv.profile : inv.profile.includes("ARSIV") ? "EARSIVFATURA" : "TICARIFATURA";
  const { data: id, error } = await supabase.rpc("inv_save", {
    p: {
      direction, type: inv.type_code === "IADE" ? "return" : "invoice", party_id: partyId, doc_no: inv.doc_no, ettn: inv.ettn && /^[0-9a-f-]{36}$/i.test(inv.ettn) ? inv.ettn : null,
      invoice_date: dateOk(inv.date), invoice_time: /^\d{2}:\d{2}(:\d{2})?$/.test(inv.time ?? "") ? inv.time : null, due_date: dateOk(inv.due_date),
      currency: inv.currency, rate: inv.currency === "TRY" ? 1 : inv.rate, profile, warehouse_id: c.warehouse_id, source: "ubl",
      einvoice_status: direction === "purchase" ? "imported" : "accepted", ubl_xml: xml, note: inv.notes.join(" · ").slice(0, 1000) || null, lines,
    },
  });
  if (error) return { ok: false, message: invError(error.message) };
  if (c.post) {
    const { error: e2 } = await supabase.rpc("inv_post", { p_id: id });
    revalidate(direction, id as string);
    if (e2) return { ok: false, id: id as string, message: `Taslak olarak kaydedildi, işlenemedi: ${invError(e2.message)}` };
  }
  revalidate(direction, id as string);
  return { ok: true, id: id as string, message: c.post ? "Kaydedildi ve işlendi." : "Taslak kaydedildi." };
}
