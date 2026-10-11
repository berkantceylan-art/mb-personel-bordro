"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { ITEM_KIND, JOB_STATUS, LOWER, MATERIALS, METAL_BAND, RECEIVED, UPPER, lineAmount, parseMoney, type ItemKind, type JobStatus } from "@/lib/jobs";

const str = (f: FormData, k: string, max = 400) => String(f.get(k) ?? "").trim().slice(0, max);
const missing = (m: string) => (/(jobs|job_|lab_)/.test(m) && /exist|schema cache|relation/.test(m) ? "Supabase'de 20261125000000_lab_jobs.sql çalıştırılmalı." : m);
const TEETH = new Set([...UPPER, ...LOWER].map(String));

async function guard() {
  const s = await getSession();
  if (!s.logistics) await fail("Laboratuvar modülü için yetkiniz yok (Yönetim > Kullanıcılar > 'Laboratuvar / kargo').");
  return s;
}

export type JobPayload = {
  id?: string | null;
  no?: number | null;
  slip_no: string;
  customer_id: string;
  doctor_name: string;
  patient: string;
  shade: string;
  shade_cervical: string;
  shade_incisal: string;
  description: string;
  invoice_note: string;
  print_note: string;
  metal_band: string;
  received: string[];
  teeth: Record<string, string>;
  in_date: string;
  due_date: string;
  delivery_method: string;
  delivery_time: string;
  status: string;
  items: { product_id: string | null; name: string; qty: number; unit_price: number; kind: string }[];
  steps: { kind: string; out_date: string; back_date: string; delivery_method: string; delivery_time: string; done: boolean; note: string }[];
  shipment_id?: string | null;
  portal_case_id?: string | null;
  order_id?: string | null;
};

const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const cut = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "") || null;

/** İş kaydını kaydet (yeni ya da güncelle); satırlar ve prova adımları yeniden yazılır */
export async function saveJob(p: JobPayload): Promise<{ ok: boolean; id?: string; no?: number; message: string }> {
  const s = await getSession();
  if (!s.logistics) return { ok: false, message: "Yetkiniz yok." };
  if (!p.customer_id) return { ok: false, message: "Hekim / hastane seçin." };
  const teeth: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.teeth ?? {})) if (TEETH.has(k) && v in MATERIALS) teeth[k] = v;
  const supabase = await createClient();
  const { data: cust } = await supabase.from("lab_customers").select("id, currency").eq("id", p.customer_id).maybeSingle();
  if (!cust) return { ok: false, message: "Hekim / hastane bulunamadı." };
  const items = (p.items ?? [])
    .filter((i) => i.name?.trim())
    .slice(0, 50)
    .map((i, n) => {
      const kind = (i.kind in ITEM_KIND ? i.kind : "paid") as ItemKind;
      const qty = Math.min(99, Math.max(1, Math.round(Number(i.qty) || 1)));
      const unit = Math.max(0, Math.round(Number(i.unit_price) || 0));
      return { product_id: i.product_id || null, name: i.name.trim().slice(0, 160), qty, unit_price: unit, amount: lineAmount(qty, unit, kind), kind, sort: n };
    });
  const steps = (p.steps ?? [])
    .filter((x) => x.kind?.trim())
    .slice(0, 20)
    .map((x, n) => ({ kind: x.kind.trim().slice(0, 80), out_date: date(x.out_date), back_date: date(x.back_date), delivery_method: cut(x.delivery_method, 80), delivery_time: cut(x.delivery_time, 10), done: !!x.done, note: cut(x.note, 500), sort: n }));
  const status = (p.status in JOB_STATUS ? p.status : "open") as JobStatus;
  const row = {
    company_id: s.companyId,
    slip_no: cut(p.slip_no, 40),
    customer_id: p.customer_id,
    doctor_name: cut(p.doctor_name, 120),
    patient: cut(p.patient, 120),
    shade: cut(p.shade, 30),
    shade_cervical: cut(p.shade_cervical, 30),
    shade_incisal: cut(p.shade_incisal, 30),
    description: cut(p.description, 4000),
    invoice_note: cut(p.invoice_note, 500),
    print_note: cut(p.print_note, 500),
    metal_band: p.metal_band in METAL_BAND ? p.metal_band : null,
    received: (p.received ?? []).filter((r) => r in RECEIVED),
    teeth,
    in_date: date(p.in_date) ?? new Date().toISOString().slice(0, 10),
    due_date: date(p.due_date),
    delivery_method: cut(p.delivery_method, 80),
    delivery_time: cut(p.delivery_time, 10),
    status,
    currency: cust.currency as string,
    total: items.reduce((a, i) => a + i.amount, 0),
    ...(p.shipment_id ? { shipment_id: p.shipment_id } : {}),
    ...(p.portal_case_id ? { portal_case_id: p.portal_case_id } : {}),
  };
  let id = p.id ?? null;
  let no: number | undefined;
  if (id) {
    const { error } = await supabase.from("jobs").update(row).eq("id", id);
    if (error) return { ok: false, message: missing(error.message) };
  } else {
    const wantNo = Number(p.no) > 0 ? Math.round(Number(p.no)) : null;
    const { data, error } = await supabase.from("jobs").insert({ ...row, ...(wantNo ? { no: wantNo } : {}) }).select("id, no").single();
    if (error || !data) return { ok: false, message: error?.message.includes("jobs_no_key") ? "Bu iş numarası kullanılmış." : missing(error?.message ?? "Kaydedilemedi") };
    id = data.id as string;
    no = data.no as number;
    // Siparişten açıldıysa sipariş "işe dönüştü"
    if (p.order_id) await supabase.rpc("lab_order_link", { p_order: p.order_id, p_job: id });
    // Kargodan açıldıysa gönderiyi "iş kaydı açıldı" yap
    if (p.shipment_id) {
      await supabase.from("shipments").update({ status: "job_created" }).eq("id", p.shipment_id);
      await supabase.from("shipment_events").insert({ shipment_id: p.shipment_id, status: "job_created", note: `İş kaydı #${no}`, source: "system" });
      revalidatePath(`/kargo/${p.shipment_id}`);
    }
  }
  await supabase.from("job_items").delete().eq("job_id", id);
  if (items.length) {
    const { error } = await supabase.from("job_items").insert(items.map((i) => ({ ...i, job_id: id })));
    if (error) return { ok: false, id, message: `Satırlar kaydedilemedi: ${error.message}` };
  }
  await supabase.from("job_steps").delete().eq("job_id", id);
  if (steps.length) {
    const { error } = await supabase.from("job_steps").insert(steps.map((x) => ({ ...x, job_id: id })));
    if (error) return { ok: false, id, message: `Prova adımları kaydedilemedi: ${error.message}` };
  }
  revalidatePath("/isler");
  revalidatePath(`/isler/${id}`);
  if (!no) {
    const { data } = await supabase.from("jobs").select("no").eq("id", id).single();
    no = data?.no as number;
  }
  return { ok: true, id: id!, no, message: `İş #${no} kaydedildi.` };
}

export async function setJobStatus(f: FormData) {
  await guard();
  const id = str(f, "id", 40);
  const status = str(f, "status", 20) as JobStatus;
  if (!(status in JOB_STATUS)) await fail("Geçersiz durum.");
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ status }).eq("id", id);
  if (error) await fail(missing(error.message));
  revalidatePath("/isler");
  revalidatePath(`/isler/${id}`);
  await done(`Durum: ${JOB_STATUS[status][0]}`);
}

export async function toggleStep(f: FormData) {
  await guard();
  const id = str(f, "id", 40);
  const supabase = await createClient();
  const { error } = await supabase.from("job_steps").update({ done: f.get("done") === "1" }).eq("id", id);
  if (error) await fail(missing(error.message));
  revalidatePath("/isler/prova");
  revalidatePath("/isler");
  await done("Güncellendi.");
}

export async function deleteJob(f: FormData) {
  const s = await guard();
  if (!["owner", "accountant", "hr"].includes(s.role)) await fail("Silme yetkisi yalnız sahip, muhasebe ve İK'da.");
  const id = str(f, "id", 40);
  const supabase = await createClient();
  const { data: files } = await supabase.from("job_files").select("path").eq("job_id", id);
  if (files?.length) await supabase.storage.from("job-files").remove(files.map((x) => x.path as string));
  const { error } = await supabase.from("jobs").delete().eq("id", id);
  if (error) await fail(missing(error.message));
  revalidatePath("/isler");
  redirect(`/isler?tamam=${encodeURIComponent("İş kaydı silindi.")}`);
}

export async function recordJobFile(input: { jobId: string; path: string; name: string }) {
  const s = await getSession();
  if (!s.logistics) return { ok: false, message: "Yetkiniz yok." };
  if (!input.path.startsWith(`${input.jobId}/`)) return { ok: false, message: "Geçersiz yol." };
  const supabase = await createClient();
  const { error } = await supabase.from("job_files").insert({ job_id: input.jobId, path: input.path, name: input.name.slice(0, 200) });
  if (error) return { ok: false, message: missing(error.message) };
  revalidatePath(`/isler/${input.jobId}`);
  return { ok: true, message: "Yüklendi." };
}

// ---------------------------------------------------------------------
// Hekim / hastane (müşteri) kartları
// ---------------------------------------------------------------------
export async function saveCustomer(f: FormData) {
  const s = await guard();
  const id = str(f, "id", 40) || null;
  const name = str(f, "name", 160);
  if (!name) await fail("Ad zorunlu.");
  const disc = Number(str(f, "discount_pct", 6).replace(",", "."));
  const row = {
    company_id: s.companyId,
    name,
    kind: ["doctor_tr", "doctor_foreign", "clinic", "hospital", "agency"].includes(str(f, "kind")) ? str(f, "kind") : "doctor_tr",
    portal_account_id: str(f, "portal_account_id", 40) || null,
    currency: ["TRY", "EUR", "USD"].includes(str(f, "currency")) ? str(f, "currency") : "TRY",
    phone: str(f, "phone", 40) || null,
    email: str(f, "email", 200) || null,
    country: str(f, "country", 60) || "TR",
    city: str(f, "city", 80) || null,
    address: str(f, "address", 400) || null,
    tax_office: str(f, "tax_office", 80) || null,
    tax_no: str(f, "tax_no", 20) || null,
    discount_pct: Number.isFinite(disc) ? Math.min(100, Math.max(0, disc)) : 0,
    note: str(f, "note", 2000) || null,
    is_active: f.get("is_active") !== "off",
  };
  const supabase = await createClient();
  let cid = id;
  if (id) {
    const { error } = await supabase.from("lab_customers").update(row).eq("id", id);
    if (error) await fail(error.message.includes("portal_account_id") ? "Bu portal hesabı başka bir karta bağlı." : missing(error.message));
  } else {
    const { data, error } = await supabase.from("lab_customers").insert(row).select("id").single();
    if (error || !data) await fail(error?.message.includes("portal_account_id") ? "Bu portal hesabı başka bir karta bağlı." : missing(error?.message ?? "Kaydedilemedi"));
    cid = data!.id as string;
  }
  // Yeni doktor adları (virgülle)
  const docs = str(f, "doctors", 1000).split(/[,\n]/).map((d) => d.trim()).filter(Boolean).slice(0, 30);
  if (docs.length) await supabase.from("lab_customer_doctors").insert(docs.map((name) => ({ customer_id: cid, name: name.slice(0, 120) })));
  revalidatePath("/isler/hekimler");
  redirect(`/isler/hekimler/${cid}?tamam=${encodeURIComponent("Kaydedildi.")}`);
}

export async function deleteDoctor(f: FormData) {
  await guard();
  const supabase = await createClient();
  await supabase.from("lab_customer_doctors").delete().eq("id", str(f, "id", 40));
  revalidatePath("/isler/hekimler");
  await done("Doktor silindi.");
}

export async function deleteCustomer(f: FormData) {
  await guard();
  const supabase = await createClient();
  const { error } = await supabase.from("lab_customers").delete().eq("id", str(f, "id", 40));
  if (error) await fail(error.message.includes("foreign key") ? "Bu karta bağlı işler var; silmek yerine pasif yapın." : missing(error.message));
  revalidatePath("/isler/hekimler");
  redirect(`/isler/hekimler?tamam=${encodeURIComponent("Silindi.")}`);
}

// ---------------------------------------------------------------------
// Protez / ürün kartları
// ---------------------------------------------------------------------
export async function saveProduct(f: FormData) {
  const s = await guard();
  const id = str(f, "id", 40) || null;
  const name = str(f, "name", 160);
  if (!name) await fail("Ürün adı zorunlu.");
  const row = {
    company_id: s.companyId,
    code: str(f, "code", 30) || null,
    name,
    material: str(f, "material", 30) in MATERIALS ? str(f, "material", 30) : null,
    price_try: parseMoney(str(f, "price_try", 20)),
    price_eur: parseMoney(str(f, "price_eur", 20)),
    per_unit: f.get("per_unit") !== "off",
    sort: Number(str(f, "sort", 6)) || 0,
    is_active: f.get("is_active") !== "off",
  };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("lab_products").update(row).eq("id", id) : await supabase.from("lab_products").insert(row);
  if (error) await fail(missing(error.message));
  revalidatePath("/isler/urunler");
  redirect(`/isler/urunler?tamam=${encodeURIComponent("Ürün kaydedildi.")}`);
}

export async function deleteProduct(f: FormData) {
  await guard();
  const supabase = await createClient();
  const { error } = await supabase.from("lab_products").delete().eq("id", str(f, "id", 40));
  if (error) await fail(missing(error.message));
  revalidatePath("/isler/urunler");
  await done("Ürün silindi.");
}

/** Sitedeki genel fiyat listesinden ürün kartı oluştur (aynı adlı varsa atlanır) */
export async function importProductsFromPriceList() {
  const s = await guard();
  const supabase = await createClient();
  const [{ data: items, error }, { data: existing }] = await Promise.all([
    supabase.from("cms_price_items").select("name, price_try, price_eur, sort, is_active").order("sort"),
    supabase.from("lab_products").select("name"),
  ]);
  if (error) await fail("Sitedeki fiyat listesi okunamadı (site yönetim yetkisi ya da tablo eksik).");
  const have = new Set((existing ?? []).map((x) => String(x.name).toLocaleLowerCase("tr")));
  const rows = (items ?? [])
    .map((i) => ({ name: String((i.name as { tr?: string } | null)?.tr ?? "").trim(), try: i.price_try as number | null, eur: i.price_eur as number | null, sort: i.sort as number }))
    .filter((i) => i.name && !have.has(i.name.toLocaleLowerCase("tr")))
    .map((i) => ({ company_id: s.companyId, name: i.name.slice(0, 160), price_try: i.try != null ? Math.round(Number(i.try) * 100) : null, price_eur: i.eur != null ? Math.round(Number(i.eur) * 100) : null, sort: i.sort ?? 0 }));
  if (rows.length) {
    const { error: e2 } = await supabase.from("lab_products").insert(rows);
    if (e2) await fail(missing(e2.message));
  }
  revalidatePath("/isler/urunler");
  await done(rows.length ? `${rows.length} ürün fiyat listesinden aktarıldı.` : "Aktarılacak yeni ürün yok.");
}

// ---------------------------------------------------------------------
// Liste ayarları (teslim şekli, prova türü) ve iş numarası
// ---------------------------------------------------------------------
export async function addOption(f: FormData) {
  await guard();
  const kind = ["tryin", "bank"].includes(str(f, "kind")) ? str(f, "kind") : "delivery";
  const value = str(f, "value", kind === "bank" ? 200 : 80);
  if (!value) await fail("Değer yazın.");
  const supabase = await createClient();
  const { error } = await supabase.from("lab_options").insert({ kind, value, sort: Number(str(f, "sort", 4)) || 50 });
  if (error) await fail(error.message.includes("duplicate") ? "Bu değer zaten var." : missing(error.message));
  revalidatePath("/isler/ayarlar");
  await done("Eklendi.");
}

export async function deleteOption(f: FormData) {
  await guard();
  const supabase = await createClient();
  await supabase.from("lab_options").delete().eq("id", str(f, "id", 40));
  revalidatePath("/isler/ayarlar");
  await done("Silindi.");
}

// ---------------------------------------------------------------------
// Tahsilat (cari hesap)
// ---------------------------------------------------------------------
export async function savePayment(f: FormData) {
  await guard();
  const customerId = str(f, "customer_id", 40);
  const amount = parseMoney(str(f, "amount", 20));
  if (!customerId) await fail("Hekim / hastane seçin.");
  if (!amount) await fail("Tutar girin (ör. 1.250,00).");
  const supabase = await createClient();
  const { data: c } = await supabase.from("lab_customers").select("currency").eq("id", customerId).maybeSingle();
  const row = {
    customer_id: customerId,
    paid_on: /^\d{4}-\d{2}-\d{2}$/.test(str(f, "paid_on")) ? str(f, "paid_on") : new Date().toISOString().slice(0, 10),
    amount,
    currency: ["TRY", "EUR", "USD"].includes(str(f, "currency")) ? str(f, "currency") : (c?.currency as string) ?? "TRY",
    method: ["cash", "bank", "card", "check", "offset", "other"].includes(str(f, "method")) ? str(f, "method") : "bank",
    ref: str(f, "ref", 80) || null,
    note: str(f, "note", 500) || null,
  };
  const { error } = await supabase.from("lab_payments").insert(row);
  if (error) await fail(/lab_payments/.test(error.message) ? "Supabase'de 20261127000000_lab_accounts.sql çalıştırılmalı." : error.message);
  revalidatePath(`/isler/hekimler/${customerId}`);
  revalidatePath("/isler/cari");
  await done("Tahsilat kaydedildi.");
}

export async function deletePayment(f: FormData) {
  const s = await guard();
  if (!["owner", "accountant"].includes(s.role)) await fail("Tahsilat silme yetkisi yalnız sahip ve muhasebede.");
  const supabase = await createClient();
  const { error } = await supabase.from("lab_payments").delete().eq("id", str(f, "id", 40));
  if (error) await fail(error.message);
  revalidatePath("/isler/cari");
  await done("Tahsilat silindi.");
}

// ---------------------------------------------------------------------
// Hekime / kuruma özel fiyat
// ---------------------------------------------------------------------
export async function saveCustomerPrice(f: FormData) {
  await guard();
  const customerId = str(f, "customer_id", 40);
  const productId = str(f, "product_id", 40);
  if (!customerId || !productId) await fail("Ürün seçin.");
  const row = { customer_id: customerId, product_id: productId, price_try: parseMoney(str(f, "price_try", 20)), price_eur: parseMoney(str(f, "price_eur", 20)) };
  if (row.price_try == null && row.price_eur == null) await fail("En az bir fiyat girin.");
  const supabase = await createClient();
  const { error } = await supabase.from("lab_customer_prices").upsert(row);
  if (error) await fail(/lab_customer_prices/.test(error.message) ? "Supabase'de 20261128000000_portal_teams.sql çalıştırılmalı." : error.message);
  revalidatePath(`/isler/hekimler/${customerId}`);
  await done("Özel fiyat kaydedildi.");
}

export async function deleteCustomerPrice(f: FormData) {
  await guard();
  const supabase = await createClient();
  await supabase.from("lab_customer_prices").delete().eq("customer_id", str(f, "customer_id", 40)).eq("product_id", str(f, "product_id", 40));
  revalidatePath(`/isler/hekimler/${str(f, "customer_id", 40)}`);
  await done("Özel fiyat silindi.");
}
