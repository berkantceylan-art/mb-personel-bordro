"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface SupResult { ok: boolean; message: string }
const UUID = /^[0-9a-f-]{36}$/i;
const err = (m: string) => (/order_closed/.test(m) ? "Bu sipariş kapanmış ya da iptal edilmiş." : /sup_order|does not exist/.test(m) ? "Sistem güncelleniyor, lütfen biraz sonra tekrar deneyin." : "İşlem yapılamadı, tekrar deneyin.");

/** Tedarikçi: siparişi aldım (termin) ya da karşılayamıyoruz */
export async function supAck(_: SupResult | null, f: FormData): Promise<SupResult> {
  const token = String(f.get("token") ?? "");
  if (!UUID.test(token)) return { ok: false, message: "Geçersiz bağlantı." };
  const ok = String(f.get("ok") ?? "1") === "1";
  const date = String(f.get("date") ?? "");
  const note = String(f.get("note") ?? "").slice(0, 1000);
  const name = String(f.get("name") ?? "").slice(0, 120);
  if (!ok && !note.trim()) return { ok: false, message: "Lütfen nedenini yazın (ör. stokta yok, şu tarihte gelir)." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("sup_order_ack", { p_token: token, p_ok: ok, p_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, p_note: note || null, p_name: name || null });
  if (error) return { ok: false, message: err(error.message) };
  revalidatePath(`/tedarikci/siparis/${token}`);
  return { ok: true, message: ok ? "Teşekkürler, siparişi aldığınız bildirildi." : "Bildiriminiz iletildi." };
}

/** Tedarikçi: sevk ettim (irsaliye no) */
export async function supShip(_: SupResult | null, f: FormData): Promise<SupResult> {
  const token = String(f.get("token") ?? "");
  if (!UUID.test(token)) return { ok: false, message: "Geçersiz bağlantı." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("sup_order_ship", { p_token: token, p_waybill: String(f.get("waybill") ?? "").slice(0, 60) || null, p_note: String(f.get("note") ?? "").slice(0, 1000) || null });
  if (error) return { ok: false, message: err(error.message) };
  revalidatePath(`/tedarikci/siparis/${token}`);
  return { ok: true, message: "Teşekkürler, sevkiyat bildirildi." };
}

/** Tedarikçi: teklif ver (bağlantıyla, hesapsız) */
export async function supRfqSubmit(_: SupResult | null, f: FormData): Promise<SupResult> {
  const token = String(f.get("token") ?? "");
  if (!UUID.test(token)) return { ok: false, message: "Geçersiz bağlantı." };
  const decline = f.get("decline") === "1";
  const lineIds = f.getAll("line").map(String).filter((x) => UUID.test(x));
  const num = (v: string) => { const t = v.trim(); if (!t) return null; const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
  const quotes = lineIds.map((id) => { const p = num(String(f.get(`p_${id}`) ?? "")); return { line_id: id, unit_price: p, vat_rate: String(f.get(`v_${id}`) ?? "20"), available: p != null && f.get(`na_${id}`) !== "on", note: String(f.get(`n_${id}`) ?? "").slice(0, 300) }; });
  if (!decline && !quotes.some((q) => q.available)) return { ok: false, message: "En az bir kalem için fiyat yazın ya da \"Teklif veremiyoruz\" seçin." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("sup_rfq_submit", { p_token: token, p: { decline, quotes, delivery_days: String(f.get("delivery_days") ?? "") || null, valid_until: String(f.get("valid_until") ?? "") || null, note: String(f.get("note") ?? "").slice(0, 1000), name: String(f.get("name") ?? "").slice(0, 120) } });
  if (error) return { ok: false, message: /rfq_closed/.test(error.message) ? "Bu teklif isteği kapanmış." : err(error.message) };
  revalidatePath(`/tedarikci/teklif/${token}`);
  return { ok: true, message: decline ? "Bilginiz iletildi, teşekkürler." : "Teklifiniz iletildi, teşekkürler." };
}
