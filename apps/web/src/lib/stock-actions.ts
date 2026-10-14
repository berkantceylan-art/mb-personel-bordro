"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { CURRENCIES, dateOk, parseAmount, today } from "@/lib/fin";
import { ITEM_KIND, UNITS, WH_KIND, parseQty, stockError } from "@/lib/stock";

const str = (f: FormData, k: string, max = 400) => String(f.get(k) ?? "").trim().slice(0, max);
const opt = (f: FormData, k: string, max = 400) => str(f, k, max) || null;
const cur = (v: string) => ((CURRENCIES as readonly string[]).includes(v) ? v : "TRY");

async function need(level: number, mod = "stock") {
  const s = await getSession();
  if ((s.modules[mod] ?? 0) < level) await fail("Bu işlem için stok yetkiniz yok (Yönetim > Yetkiler).");
  return s;
}

export async function saveItem(form: FormData) {
  await need(2);
  const id = str(form, "id", 40);
  const supabase = await createClient();
  let code = str(form, "code", 40);
  if (!code) {
    const { data } = await supabase.rpc("stk_next_code", { p_prefix: str(form, "kind") === "product" ? "U" : str(form, "kind") === "service" ? "H" : "M" });
    code = (data as string) || `M${Date.now().toString().slice(-6)}`;
  }
  const name = str(form, "name", 200);
  if (!name) await fail("Ad yazın.");
  const row = {
    code,
    name,
    barcode: opt(form, "barcode", 64),
    kind: str(form, "kind") in ITEM_KIND ? str(form, "kind") : "material",
    category_id: opt(form, "category_id", 40),
    unit: UNITS.includes(str(form, "unit")) ? str(form, "unit") : str(form, "unit", 20) || "adet",
    brand: opt(form, "brand", 80),
    supplier_party_id: opt(form, "supplier_party_id", 40),
    purchase_price: parseAmount(str(form, "purchase_price")),
    purchase_currency: cur(str(form, "purchase_currency")),
    sale_price: parseAmount(str(form, "sale_price")),
    sale_currency: cur(str(form, "sale_currency")),
    vat_rate: [0, 1, 10, 20].includes(Number(str(form, "vat_rate"))) ? Number(str(form, "vat_rate")) : 20,
    min_qty: parseQty(str(form, "min_qty")),
    max_qty: parseQty(str(form, "max_qty")),
    reorder_qty: parseQty(str(form, "reorder_qty")),
    track_lot: form.get("track_lot") === "on",
    track_expiry: form.get("track_expiry") === "on",
    shelf: opt(form, "shelf", 40),
    lab_product_id: opt(form, "lab_product_id", 40),
    default_warehouse_id: opt(form, "default_warehouse_id", 40),
    note: opt(form, "note", 2000),
    is_active: form.get("is_active") !== "off",
  };
  // ÜTS alanları (yalnız kullanılıyorsa gönderilir; 20270205000000_uts.sql çalışmadan da kart kaydedilebilsin)
  const utsNo = str(form, "uts_product_no").replace(/\s/g, "");
  if (form.get("uts_tracked") === "on" || utsNo || form.get("uts_was") === "1") {
    if (utsNo && !/^[0-9A-Za-z]{1,25}$/.test(utsNo)) await fail("ÜTS ürün numarası yalnız harf ve rakam olmalı (karekoddaki (01) numarası).");
    Object.assign(row, { uts_tracked: form.get("uts_tracked") === "on", uts_product_no: utsNo || null, uts_kind: str(form, "uts_kind") === "serial" ? "serial" : "lot", uts_flow: str(form, "uts_flow") === "transfer" ? "transfer" : "use" });
    if (form.get("uts_tracked") === "on") Object.assign(row, { track_lot: true });
  }
  const res = id ? await supabase.from("stk_items").update(row).eq("id", id).select("id").single() : await supabase.from("stk_items").insert(row).select("id").single();
  if (res.error) await fail(stockError(res.error.message));
  revalidatePath("/stok", "layout");
  if (!id) redirect(`/stok/urunler/${res.data!.id}?tamam=${encodeURIComponent("Kart açıldı. Açılış stoğunu aşağıdan girebilirsiniz.")}`);
  await done("Kart kaydedildi.");
}

export async function saveStockCategory(form: FormData) {
  await need(2);
  const name = str(form, "name", 80);
  if (!name) await fail("Kategori adı yazın.");
  const supabase = await createClient();
  const { error } = await supabase.from("stk_categories").insert({ name, parent_id: opt(form, "parent_id", 40) });
  if (error) await fail(stockError(error.message));
  revalidatePath("/stok", "layout");
  await done("Kategori eklendi.");
}

export async function saveWarehouse(form: FormData) {
  await need(3);
  const id = str(form, "id", 40);
  const name = str(form, "name", 80);
  if (!name) await fail("Depo adı yazın.");
  const row = {
    name,
    code: opt(form, "code", 20),
    kind: str(form, "kind") in WH_KIND ? str(form, "kind") : "main",
    address: opt(form, "address", 300),
    responsible: opt(form, "responsible", 120),
    is_active: form.get("is_active") !== "off",
  };
  const supabase = await createClient();
  const res = id ? await supabase.from("stk_warehouses").update(row).eq("id", id) : await supabase.from("stk_warehouses").insert(row);
  if (res.error) await fail(stockError(res.error.message));
  if (form.get("is_default") === "on") {
    const target = id || (await supabase.from("stk_warehouses").select("id").eq("name", name).order("created_at", { ascending: false }).limit(1).single()).data?.id;
    if (target) {
      await supabase.from("stk_warehouses").update({ is_default: false }).neq("id", target);
      await supabase.from("stk_warehouses").update({ is_default: true }).eq("id", target);
    }
  }
  revalidatePath("/stok", "layout");
  await done("Depo kaydedildi.");
}

/** Açılış stoğu, sayım dışı düzeltme, fire, tüketim */
export async function adjustStock(form: FormData) {
  const kind = str(form, "kind", 20);
  await need(2, kind === "consume" ? "production" : "stock");
  const q = parseQty(str(form, "qty"));
  if (!q) await fail("Miktarı yazın.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("stk_adjust", {
    p_item: str(form, "item_id", 40), p_warehouse: str(form, "warehouse_id", 40) || null, p_qty: q, p_kind: kind,
    p_unit_cost: parseAmount(str(form, "unit_cost")), p_lot: opt(form, "lot_no", 60), p_expiry: dateOk(str(form, "expiry_date")),
    p_date: dateOk(str(form, "date")) ?? today(), p_note: opt(form, "note", 300), p_job: null,
  });
  if (error) await fail(stockError(error.message));
  revalidatePath("/stok", "layout");
  await done("Stok hareketi kaydedildi.");
}

export async function saveBom(form: FormData) {
  await need(2);
  const q = parseQty(str(form, "qty"));
  if (!q || q <= 0) await fail("Birim başına miktarı yazın.");
  const supabase = await createClient();
  const { error } = await supabase.from("stk_boms").upsert({ lab_product_id: str(form, "lab_product_id", 40), item_id: str(form, "item_id", 40), qty: q, waste_pct: Math.min(100, Math.max(0, Number(str(form, "waste_pct").replace(",", ".")) || 0)), note: opt(form, "note", 200) }, { onConflict: "lab_product_id,item_id" });
  if (error) await fail(stockError(error.message));
  revalidatePath("/stok/receteler");
  await done("Reçete satırı kaydedildi.");
}

export async function deleteBom(form: FormData) {
  await need(2);
  const supabase = await createClient();
  const { error } = await supabase.from("stk_boms").delete().eq("id", str(form, "id", 40));
  if (error) await fail(stockError(error.message));
  revalidatePath("/stok/receteler");
  await done("Satır silindi.");
}

// ---------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------
export type TransferPayload = { from: string; to: string; date: string; note: string; lines: { item_id: string; qty: number; lot_no: string | null }[]; send: "draft" | "send" | "now" };

export async function createTransfer(p: TransferPayload): Promise<{ ok: boolean; id?: string; message: string }> {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 2) return { ok: false, message: "Stok yetkiniz yok." };
  if (!p.from || !p.to || p.from === p.to) return { ok: false, message: "Farklı iki depo seçin." };
  const lines = p.lines.filter((l) => l.item_id && l.qty > 0);
  if (!lines.length) return { ok: false, message: "En az bir satır ekleyin." };
  const supabase = await createClient();
  const { data: t, error } = await supabase.from("stk_transfers").insert({ from_warehouse_id: p.from, to_warehouse_id: p.to, transfer_date: dateOk(p.date) ?? today(), note: p.note?.slice(0, 500) || null }).select("id").single();
  if (error || !t) return { ok: false, message: stockError(error?.message ?? "Kaydedilemedi") };
  const { error: le } = await supabase.from("stk_transfer_lines").insert(lines.map((l) => ({ transfer_id: t.id, item_id: l.item_id, qty: l.qty, lot_no: l.lot_no?.trim() || null })));
  if (le) return { ok: false, message: stockError(le.message) };
  if (p.send !== "draft") {
    const { error: se } = await supabase.rpc("stk_transfer_send", { p_transfer: t.id, p_receive: p.send === "now" });
    if (se) return { ok: false, id: t.id, message: `Transfer taslak olarak kaydedildi ama gönderilemedi: ${stockError(se.message)}` };
  }
  revalidatePath("/stok", "layout");
  return { ok: true, id: t.id, message: p.send === "now" ? "Transfer tamamlandı." : p.send === "send" ? "Transfer gönderildi; giriş deposu teslim alınca stoğa girer." : "Taslak kaydedildi." };
}

export async function transferAction(form: FormData) {
  await need(2);
  const id = str(form, "id", 40);
  const op = str(form, "op", 20);
  const supabase = await createClient();
  let error: { message: string } | null = null;
  if (op === "send") ({ error } = await supabase.rpc("stk_transfer_send", { p_transfer: id, p_receive: false }));
  else if (op === "receive") {
    const received: Record<string, number> = {};
    for (const [k, v] of form.entries()) if (k.startsWith("got_")) { const q = parseQty(String(v)); if (q !== null) received[k.slice(4)] = q; }
    ({ error } = await supabase.rpc("stk_transfer_receive", { p_transfer: id, p_received: received }));
  } else if (op === "cancel") ({ error } = await supabase.rpc("stk_transfer_cancel", { p_transfer: id }));
  if (error) await fail(stockError(error.message));
  revalidatePath("/stok", "layout");
  await done(op === "receive" ? "Teslim alındı; stoğa girdi." : op === "send" ? "Gönderildi." : "İptal edildi.");
}

// ---------------------------------------------------------------------
// Sayım
// ---------------------------------------------------------------------
export async function startCount(form: FormData) {
  await need(2);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stk_count_start", { p_warehouse: str(form, "warehouse_id", 40), p_category: opt(form, "category_id", 40), p_blind: form.get("blind") === "on", p_note: opt(form, "note", 500), p_all_items: form.get("all_items") === "on" });
  if (error) await fail(stockError(error.message));
  redirect(`/stok/sayim/${data}`);
}

export async function saveCountLines(form: FormData) {
  await need(2);
  const supabase = await createClient();
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("c_") || String(v).trim() === "") continue;
    const q = parseQty(String(v));
    if (q === null || q < 0) continue;
    const { error } = await supabase.rpc("stk_count_set", { p_line: k.slice(2), p_counted: q, p_add: false });
    if (error) await fail(stockError(error.message));
  }
  revalidatePath(`/stok/sayim/${str(form, "id", 40)}`);
  await done("Sayılan miktarlar kaydedildi.");
}

export async function scanCount(countId: string, code: string, qtyIn: number, lot: string | null): Promise<{ ok: boolean; message: string; item?: string; counted?: number; unit?: string }> {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 2) return { ok: false, message: "Stok yetkiniz yok." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stk_count_scan", { p_count: countId, p_code: code.trim(), p_qty: qtyIn || 1, p_lot: lot?.trim() || null });
  if (error) return { ok: false, message: stockError(error.message) };
  const d = data as { item: string; counted: number; unit: string };
  return { ok: true, message: `${d.item}: ${d.counted} ${d.unit}`, item: d.item, counted: Number(d.counted), unit: d.unit };
}

export async function closeCount(form: FormData) {
  await need(3);
  const id = str(form, "id", 40);
  const supabase = await createClient();
  if (str(form, "op") === "cancel") {
    const { error } = await supabase.rpc("stk_count_cancel", { p_count: id });
    if (error) await fail(stockError(error.message));
    revalidatePath("/stok/sayim");
    await done("Sayım iptal edildi.");
  }
  const { data, error } = await supabase.rpc("stk_count_close", { p_count: id, p_zero_uncounted: form.get("zero") === "on" });
  if (error) await fail(stockError(error.message));
  revalidatePath("/stok", "layout");
  await done(`Sayım kapandı; ${data ?? 0} kalemde fark stoğa işlendi.`);
}

/** Lot durumu: kullanılabilir / karantina / geri çağrıldı */
export async function setLotStatus(form: FormData) {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 2 && (s.modules.production ?? 0) < 3) await fail("Bu işlem için stok yetkiniz yok (Yönetim > Yetkiler).");
  const item = str(form, "item_id", 40);
  const lot = str(form, "lot_no", 60);
  const status = str(form, "status", 20);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stk_lot_set_status", { p_item: item, p_lot: lot, p_status: status, p_reason: opt(form, "reason", 500), p_cert: opt(form, "cert_no", 80), p_supplier: null, p_note: opt(form, "note", 500) });
  if (error) await fail(stockError(error.message));
  revalidatePath("/stok/lotlar");
  await done(status === "recalled" ? `Lot geri çağrıldı. ${data ?? 0} işte kullanılmış; aşağıdaki listeden hekimlere haber verin.` : status === "quarantine" ? "Lot karantinaya alındı; iş ve satışta kullanılamaz." : "Lot kullanıma açıldı.");
}
