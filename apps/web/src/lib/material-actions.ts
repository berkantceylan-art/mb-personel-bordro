"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { mrError } from "@/lib/material";

export type MrState = { ok?: boolean; message: string; id?: string };
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (id?: string) => {
  revalidatePath("/benim/malzeme");
  revalidatePath("/istekler");
  revalidatePath("/stok/talepler");
  if (id) revalidatePath(`/stok/talepler/${id}`);
};
const png = (v: string) => (v.startsWith("data:image/png;base64,") && v.length <= 400000 ? v : "");

/** Personel: yeni istek (lines JSON: [{item_id?, name?, qty, unit?, note?}]) */
export async function createMaterialRequest(_: MrState | null, f: FormData): Promise<MrState> {
  let lines: unknown;
  try { lines = JSON.parse(s(f, "lines") || "[]"); } catch { return { ok: false, message: "Kalemler okunamadı." }; }
  if (!Array.isArray(lines) || lines.length === 0) return { ok: false, message: "En az bir malzeme ekleyin." };
  const kind = ["asset", "supply"].includes(s(f, "kind")) ? s(f, "kind") : "material";
  const p = { kind, reason: s(f, "reason"), needed_by: s(f, "needed_by") || null, lines };
  const supabase = await createClient();
  const { data, error } = kind === "material" ? await supabase.rpc("stk_req_create", { p }) : await supabase.rpc("stk_req_create2", { p });
  if (error) return { ok: false, message: mrError(error.message) };
  back();
  return { ok: true, message: kind === "supply" ? "Siparişiniz depo sorumlusuna iletildi." : "İsteğiniz depo sorumlusuna iletildi.", id: data as string };
}

export async function cancelMaterialRequest(f: FormData) {
  const supabase = await createClient();
  await supabase.rpc("stk_req_cancel", { p_id: s(f, "id") });
  back(s(f, "id"));
}

/** Depo: prepare / purchase / reject */
export async function stockDecision(_: MrState | null, f: FormData): Promise<MrState> {
  const id = s(f, "id");
  const action = s(f, "action");
  const lines = f.getAll("purchase_line").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const supabase = await createClient();
  const { error } = await supabase.rpc("stk_req_stock", { p_id: id, p_action: action, p_note: s(f, "note") || null, p_lines: action === "purchase" && lines.length ? lines : null });
  if (error) return { ok: false, message: mrError(error.message) };
  back(id);
  return { ok: true, message: action === "prepare" ? "Teslime hazır; personele bildirildi." : action === "purchase" ? "Satın almaya gönderildi." : "İstek reddedildi; personele bildirildi." };
}

/** Satın alma: approve / reject / bought */
export async function purchaseDecision(_: MrState | null, f: FormData): Promise<MrState> {
  const id = s(f, "id");
  const action = s(f, "action");
  const supabase = await createClient();
  const { error } = await supabase.rpc("stk_req_purchase", { p_id: id, p_action: action, p_note: s(f, "note") || null });
  if (error) return { ok: false, message: mrError(error.message) };
  back(id);
  return { ok: true, message: action === "approve" ? "Satın alma onaylandı." : action === "bought" ? "Depoya geldi olarak işaretlendi; teslime hazır." : "Reddedildi." };
}

/** Depo: teslim + imza(lar) */
export async function deliverMaterial(_: MrState | null, f: FormData): Promise<MrState> {
  const ses = await getSession();
  const id = s(f, "id");
  let lines: unknown;
  try { lines = JSON.parse(s(f, "lines") || "[]"); } catch { return { ok: false, message: "Miktarlar okunamadı." }; }
  const sig = png(s(f, "sig_warehouse"));
  if (!sig) return { ok: false, message: "Depo sorumlusu imzası gerekli." };
  const emp = png(s(f, "sig_employee"));
  if (f.get("employee_here") === "on" && !emp) return { ok: false, message: "Personel imzası atılmadı (ya da “personel şimdi imzalasın” seçeneğini kaldırın)." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("stk_req_deliver", {
    p_id: id, p_lines: lines, p_warehouse: s(f, "warehouse") || null, p_signer: s(f, "signer") || ses.email || "Depo", p_png: sig, p_employee_png: emp || null,
  });
  if (error) return { ok: false, message: mrError(error.message) };
  back(id);
  revalidatePath("/stok");
  return { ok: true, message: emp ? "Teslim edildi; her iki imza kaydedildi." : "Teslim edildi; personelin kendi sayfasından imzalaması istendi." };
}

/** Personel: teslim aldım imzası */
export async function signMaterialReceipt(_: MrState | null, f: FormData): Promise<MrState> {
  const id = s(f, "id");
  const sig = png(s(f, "signature"));
  if (!sig) return { ok: false, message: "Lütfen imza atın." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("stk_req_sign", { p_id: id, p_png: sig });
  if (error) return { ok: false, message: mrError(error.message) };
  back(id);
  return { ok: true, message: "Teslim aldığınız imzalandı. Teşekkürler." };
}

// ------------------------------------------------------------- alım listesi

const UUID = /^[0-9a-f-]{36}$/;
const backBuy = (id?: string) => {
  revalidatePath("/stok/talepler");
  revalidatePath("/stok/talepler/alim");
  if (id) { revalidatePath(`/stok/talepler/alim/${id}`); revalidatePath(`/alim/${id}`); }
  revalidatePath("/kurye");
};

/** Satın alma: onaylı isteklerden alım listesi çıkar ve kuryeye ata */
export async function createBuyList(_: MrState | null, f: FormData): Promise<MrState> {
  const reqs = f.getAll("req").map(String).filter((x) => UUID.test(x));
  if (!reqs.length) return { ok: false, message: "Listeye en az bir istek seçin." };
  const vendors: Record<string, string> = {};
  const prices: Record<string, number> = {};
  for (const [k, v] of f.entries()) {
    const m = k.match(/^(vendor|price)_([0-9a-f-]{36})$/);
    if (!m || typeof v !== "string" || !v.trim()) continue;
    if (m[1] === "vendor") vendors[m[2]!] = v.trim().slice(0, 120);
    else { const n = Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100); if (Number.isFinite(n) && n >= 0) prices[m[2]!] = n; }
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stk_buy_list_create", { p: { request_ids: reqs, courier_user: s(f, "courier") || null, planned_on: s(f, "planned_on") || null, note: s(f, "note"), vendors, prices } });
  if (error) return { ok: false, message: /no_lines/.test(error.message) ? "Seçilen isteklerde listelenecek (satın alınacak, onaylı) kalem yok." : mrError(error.message) };
  backBuy(data as string);
  return { ok: true, message: "Alım listesi oluşturuldu; kuryeye bildirildi.", id: data as string };
}

/** Kurye / satın alma: kalem alındı (ödenen tutar TL, isteğe bağlı) */
export async function buyPick(line: string, picked: boolean, paidTl?: string, list?: string): Promise<MrState> {
  if (!UUID.test(line)) return { ok: false, message: "Kalem bulunamadı." };
  const n = paidTl ? Math.round(Number(paidTl.replace(/\./g, "").replace(",", ".")) * 100) : null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("stk_buy_pick", { p_line: line, p_picked: picked, p_paid: n != null && Number.isFinite(n) && n >= 0 ? n : null });
  if (error) return { ok: false, message: mrError(error.message) };
  backBuy(list);
  return { ok: true, message: picked ? "Alındı." : "Geri alındı." };
}

export async function buyListDone(_: MrState | null, f: FormData): Promise<MrState> {
  const id = s(f, "id");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stk_buy_list_done", { p_list: id, p_note: s(f, "note") || null });
  if (error) return { ok: false, message: mrError(error.message) };
  backBuy(id);
  return { ok: true, message: `Liste tamamlandı; ${data ?? 0} istek depoda teslime hazır.` };
}

export async function buyListCancel(f: FormData) {
  const id = s(f, "id");
  const supabase = await createClient();
  await supabase.rpc("stk_buy_list_cancel", { p_list: id });
  backBuy(id);
}
