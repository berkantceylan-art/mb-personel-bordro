"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { done, fail } from "@/lib/flash";
import { parseMoney } from "@/lib/jobs";
import { orderError } from "@/lib/orders";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f-]{36}$/i;

// ---------------- Klinik siparişi ----------------

export async function saveOrder(f: FormData) {
  const names = f.getAll("item_name").map(String);
  const qtys = f.getAll("item_qty").map(String);
  const items = names.map((n, i) => ({ name: n.trim().slice(0, 160), qty: Math.max(1, Math.min(99, Number(qtys[i]) || 1)) })).filter((x) => x.name);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lab_order_save", {
    p: {
      id: str(f, "id") || null, customer_id: str(f, "customer_id"), source: str(f, "source"), doctor_name: str(f, "doctor_name"), patient: str(f, "patient"), shade: str(f, "shade"),
      teeth: str(f, "teeth"), items, due_date: str(f, "due_date") || null, pickup: f.get("pickup") === "on", pickup_note: str(f, "pickup_note"), notes: str(f, "notes"),
      status: f.get("confirm") === "on" ? "confirmed" : undefined,
    },
  });
  if (error) await fail(orderError(error.message));
  revalidatePath("/isler/siparisler");
  if (f.get("to_job") === "1") redirect(`/isler/yeni?siparis=${data}`);
  await done(str(f, "id") ? "Sipariş kaydedildi." : "Sipariş alındı.");
}

export async function setOrderStatus(f: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("lab_order_status", { p_id: str(f, "id"), p_status: str(f, "status"), p_reason: str(f, "reason") || null });
  if (error) await fail(orderError(error.message));
  revalidatePath("/isler/siparisler");
  await done(str(f, "status") === "cancelled" ? "Sipariş iptal edildi." : "Sipariş onaylandı.");
}

// ---------------- Satın alma siparişi ----------------

export async function savePurchaseOrder(f: FormData) {
  const lines = (JSON.parse(str(f, "lines") || "[]") as { item_id?: string; name: string; qty: string; unit: string; unit_price: string; vat_rate: string }[])
    .map((l) => ({ item_id: l.item_id && UUID.test(l.item_id) ? l.item_id : null, name: l.name, qty: Number(String(l.qty).replace(",", ".")) || 0, unit: l.unit || "adet", unit_price: parseMoney(l.unit_price) ?? 0, vat_rate: Number(l.vat_rate) || 0 }))
    .filter((l) => l.name && l.qty > 0);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pur_order_save", {
    p: { id: str(f, "id") || null, party_id: str(f, "party_id"), order_date: str(f, "order_date") || null, expected_date: str(f, "expected_date") || null, currency: str(f, "currency") || "TRY", warehouse_id: str(f, "warehouse_id") || null, note: str(f, "note"), lines },
  });
  if (error) await fail(orderError(error.message));
  if (f.get("submit") === "1") {
    const { data: st, error: e2 } = await supabase.rpc("pur_order_submit", { p_id: data });
    if (e2) await fail(orderError(e2.message));
    revalidatePath("/alis/siparisler");
    redirect(`/alis/siparisler/${data}?tamam=${encodeURIComponent(st === "pending" ? "Sipariş onaya gönderildi." : "Sipariş onaylandı.")}`);
  }
  revalidatePath("/alis/siparisler");
  redirect(`/alis/siparisler/${data}?tamam=${encodeURIComponent("Taslak kaydedildi.")}`);
}

async function po(rpc: string, args: Record<string, unknown>, msg: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc(rpc, args);
  if (error) await fail(orderError(error.message));
  revalidatePath("/alis/siparisler");
  await done(msg);
}

export async function submitPO(f: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pur_order_submit", { p_id: str(f, "id") });
  if (error) await fail(orderError(error.message));
  revalidatePath("/alis/siparisler");
  await done(data === "pending" ? "Onay limitini aştığı için yöneticinin onayına gönderildi." : "Sipariş onaylandı.");
}
export async function decidePO(f: FormData) { await po("pur_order_decide", { p_id: str(f, "id"), p_ok: str(f, "ok") === "1", p_reason: str(f, "reason") || null }, str(f, "ok") === "1" ? "Sipariş onaylandı." : "Sipariş reddedildi, taslağa döndü."); }
export async function sentPO(f: FormData) { await po("pur_order_sent", { p_id: str(f, "id") }, "Tedarikçiye gönderildi olarak işaretlendi."); }
export async function cancelPO(f: FormData) { await po("pur_order_cancel", { p_id: str(f, "id") }, "Sipariş iptal edildi."); }
export async function receivePO(f: FormData) {
  const lines = f.getAll("line_id").map(String).map((id) => ({ line_id: id, qty: Number(str(f, `rq_${id}`).replace(",", ".")) || 0 })).filter((l) => l.qty > 0);
  if (!lines.length) await fail("Teslim alınan miktarı yazın.");
  await po("pur_order_receive", { p_id: str(f, "id"), p_lines: lines }, "Teslim alındı. Stok, alış faturası işlenince girer.");
}
export async function invoicePO(f: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pur_order_to_invoice", { p_id: str(f, "id") });
  if (error) await fail(orderError(error.message));
  revalidatePath("/alis/siparisler");
  redirect(`/fatura/${data}?tamam=${encodeURIComponent("Alış faturası taslağı hazır: belge numarasını girip işleyin.")}`);
}
export async function savePOSettings(f: FormData) { await po("pur_settings_save", { p_limit: parseMoney(str(f, "limit")) ?? 0 }, "Onay limiti kaydedildi."); }

/** Stok önerisinden tedarikçi başına taslak */
export async function draftFromSuggestions(f: FormData) {
  const supplier = str(f, "supplier_id");
  const items = f.getAll("item").map(String);
  const supabase = await createClient();
  const { data: sug, error } = await supabase.rpc("pur_suggestions");
  if (error) await fail(orderError(error.message));
  const rows = ((sug ?? []) as { item_id: string; name: string; unit: string; suggest: number; supplier_id: string | null; unit_price: number; vat_rate: number; currency: string }[]).filter((r) => items.includes(r.item_id) && (r.supplier_id ?? "") === supplier);
  if (!rows.length || !UUID.test(supplier)) await fail("Tedarikçisi tanımlı kalem seçin (stok kartında “tedarikçi”).");
  const { data, error: e2 } = await supabase.rpc("pur_order_save", { p: { party_id: supplier, currency: rows[0]!.currency, lines: rows.map((r) => ({ item_id: r.item_id, name: r.name, qty: Number(r.suggest), unit: r.unit, unit_price: r.unit_price, vat_rate: r.vat_rate })) } });
  if (e2) await fail(orderError(e2.message));
  revalidatePath("/alis/siparisler");
  redirect(`/alis/siparisler/${data}?tamam=${encodeURIComponent("Stok önerisinden taslak oluşturuldu.")}`);
}
