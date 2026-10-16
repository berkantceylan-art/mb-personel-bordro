"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { done, fail } from "@/lib/flash";
import { orderError } from "@/lib/orders";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f-]{36}$/i;
const hint = (m: string) => (/pur_from_requests|pur_order_close|pur_dashboard|po_id|closed_short|schema cache/.test(m) ? "Supabase'de mbdental-satinalma-1.sql çalıştırılmalı." : orderError(m));

/** Onaylı istek satırlarından taslak satın alma siparişi → sipariş sayfası */
export async function poFromRequests(f: FormData) {
  const lines = f.getAll("line").map(String).filter((x) => UUID.test(x));
  const party = str(f, "party_id");
  if (!lines.length) await fail("Siparişe eklenecek satırları seçin.");
  if (!UUID.test(party)) await fail("Tedarikçi seçin.");
  const sb = await createClient();
  const { data, error } = await sb.rpc("pur_from_requests", { p_lines: lines, p_party: party, p_expected: /^\d{4}-\d{2}-\d{2}$/.test(str(f, "expected")) ? str(f, "expected") : null, p_note: str(f, "note") || null });
  if (error) await fail(hint(error.message));
  revalidatePath("/satinalma", "layout");
  revalidatePath("/stok/talepler");
  redirect(`/alis/siparisler/${data as string}?tamam=${encodeURIComponent("Taslak sipariş hazırlandı. Fiyatları kontrol edip onaya gönderin.")}`);
}

/** Siparişi eksik teslimle kapat */
export async function closePO(f: FormData) {
  const id = str(f, "id");
  const sb = await createClient();
  const { error } = await sb.rpc("pur_order_close", { p_id: id, p_note: str(f, "note") || null });
  if (error) await fail(/bad_status/.test(error.message) ? "Yalnız onaylı, gönderilmiş ya da kısmi gelmiş sipariş kapatılabilir." : hint(error.message));
  revalidatePath(`/alis/siparisler/${id}`);
  revalidatePath("/satinalma", "layout");
  await done("Sipariş kapatıldı; kalan miktar artık beklenmiyor.");
}
