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
