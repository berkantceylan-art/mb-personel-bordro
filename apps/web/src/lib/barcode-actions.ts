"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { bcErrorText } from "@/lib/barcode";

export type BcState = { ok?: boolean; message: string; id?: string };
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f-]{36}$/;

const back = (...paths: string[]) => paths.forEach((p) => revalidatePath(p));

// ------------------------------------------------------------- mal kabul

export async function rcvStart(_: BcState | null, f: FormData): Promise<BcState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stk_rcv_start", { p: { po_id: s(f, "po_id") || null, party_id: s(f, "party_id") || null, warehouse_id: s(f, "warehouse_id") || null, supplier_doc: s(f, "supplier_doc"), note: s(f, "note") } });
  if (error) return { ok: false, message: bcErrorText(error.message) };
  if (s(f, "slip") === "1") {
    const { error: e2 } = await supabase.rpc("stk_rcv_use_slip", { p_id: data as string, p_on: true });
    if (e2) return { ok: false, message: /party_required/.test(e2.message) ? "Fişli alım için tedarikçi seçin." : /stk_rcv_use_slip|does not exist/.test(e2.message) ? "Supabase'de 20270129000000_slip_party.sql çalıştırılmalı." : bcErrorText(e2.message) };
  }
  back("/stok/mal-kabul");
  return { ok: true, message: "Mal kabul başladı.", id: data as string };
}

export type ScanResult = { ok: boolean; message?: string; name?: string; qty?: number; expected?: number; unit?: string; unexpected?: boolean; line?: string; track_lot?: boolean; track_expiry?: boolean };
export async function rcvScan(id: string, code: string, qty = 1): Promise<ScanResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stk_rcv_scan", { p_id: id, p_code: code, p_qty: qty });
  if (error) return { ok: false, message: bcErrorText(error.message) };
  const d = data as { name: string; qty: number; expected: number; unit: string; unexpected: boolean; line: string; track_lot: boolean; track_expiry: boolean };
  return { ok: true, ...d, qty: Number(d.qty), expected: Number(d.expected) };
}

/** GS1 / UDI karekod: GTIN + lot + SKT + seri; farklı lot / seri ayrı satıra düşer */
export async function rcvScanUdi(id: string, c: { gtin: string; lot?: string; expiry?: string; serial?: string }, qty = 1): Promise<ScanResult & { lot_no?: string | null; uts?: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stk_rcv_scan_udi", { p_id: id, p_gtin: c.gtin, p_lot: c.lot ?? null, p_expiry: c.expiry ?? null, p_serial: c.serial ?? null, p_qty: qty });
  if (error) return { ok: false, message: /stk_rcv_scan_udi|does not exist|schema cache/.test(error.message) ? "Supabase'de 20270205000000_uts.sql çalıştırılmalı." : bcErrorText(error.message) };
  const d = data as { name: string; qty: number; expected: number; unit: string; unexpected: boolean; line: string; track_lot: boolean; track_expiry: boolean; lot_no: string | null; uts: boolean };
  return { ok: true, ...d, qty: Number(d.qty), expected: Number(d.expected) };
}

export async function rcvLine(line: string, patch: { qty?: number; damaged?: number; lot_no?: string; expiry_date?: string; note?: string }): Promise<BcState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("stk_rcv_line", { p_line: line, p: patch });
  if (error) return { ok: false, message: bcErrorText(error.message) };
  return { ok: true, message: "" };
}

export async function rcvFree(id: string, name: string, qty: number, unit: string): Promise<BcState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("stk_rcv_free", { p_id: id, p_name: name, p_qty: qty, p_unit: unit });
  if (error) return { ok: false, message: bcErrorText(error.message) };
  return { ok: true, message: "Eklendi." };
}

export async function rcvRemove(line: string): Promise<BcState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("stk_rcv_remove", { p_line: line });
  if (error) return { ok: false, message: bcErrorText(error.message) };
  return { ok: true, message: "" };
}

export async function rcvConfirm(_: BcState | null, f: FormData): Promise<BcState> {
  const ses = await getSession();
  const id = s(f, "id");
  const choice = s(f, "add_stock");
  if (choice !== "yes" && choice !== "no") return { ok: false, message: "Stoğa eklensin mi? Faturalı mal için “Hayır”, faturasız mal için “Evet” seçin." };
  const png = s(f, "signature");
  if (!png.startsWith("data:image/png;base64,") || png.length > 400000) return { ok: false, message: "Teslim alan imzası gerekli." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("stk_rcv_confirm", { p_id: id, p_add_stock: choice === "yes", p_signer: s(f, "signer") || ses.email || "Depo", p_png: png, p_note: s(f, "note") || null });
  if (error) return { ok: false, message: bcErrorText(error.message) };
  back("/stok/mal-kabul", `/stok/mal-kabul/${id}`, "/stok", "/alis/siparisler");
  return { ok: true, message: choice === "yes" ? "Mal kabul onaylandı; ürünler stoğa girdi." : "Mal kabul onaylandı; stok e-fatura işlenince girecek." };
}

export async function rcvCancel(f: FormData) {
  const supabase = await createClient();
  await supabase.rpc("stk_rcv_cancel", { p_id: s(f, "id") });
  back("/stok/mal-kabul");
}

export async function rcvMatch(f: FormData) {
  const supabase = await createClient();
  const inv = s(f, "invoice");
  await supabase.rpc("stk_rcv_match", { p_id: s(f, "id"), p_invoice: UUID.test(inv) ? inv : null });
  back("/stok/mal-kabul", `/stok/mal-kabul/${s(f, "id")}`);
}

// ------------------------------------------------------------- personele teslim

export type ItemHit = { ok: boolean; message?: string; id?: string; code?: string; name?: string; unit?: string; on_hand?: number };
export async function itemLookup(code: string): Promise<ItemHit> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stk_item_lookup", { p_code: code });
  if (error) return { ok: false, message: bcErrorText(error.message) };
  if (!data) return { ok: false, message: "Bu barkod / kodla kayıtlı ürün yok." };
  const d = data as { id: string; code: string; name: string; unit: string; on_hand: number };
  return { ok: true, ...d, on_hand: Number(d.on_hand) };
}

export async function issueDirect(_: BcState | null, f: FormData): Promise<BcState> {
  const ses = await getSession();
  let lines: unknown;
  try { lines = JSON.parse(s(f, "lines") || "[]"); } catch { return { ok: false, message: "Kalemler okunamadı." }; }
  const w = s(f, "sig_warehouse"), e = s(f, "sig_employee");
  if (!w.startsWith("data:image/png;base64,")) return { ok: false, message: "Depo sorumlusu imzası gerekli." };
  if (!e.startsWith("data:image/png;base64,")) return { ok: false, message: "Personel imzası gerekli." };
  const supabase = await createClient();
  const req = s(f, "request_id");
  if (UUID.test(req)) {
    const { error } = await supabase.rpc("stk_req_deliver", { p_id: req, p_lines: lines, p_warehouse: s(f, "warehouse") || null, p_signer: s(f, "signer") || ses.email || "Depo", p_png: w, p_employee_png: e });
    if (error) return { ok: false, message: bcErrorText(error.message) };
    back("/stok/teslim", "/stok/talepler", `/stok/talepler/${req}`);
    return { ok: true, message: "Teslim edildi; iki imzalı tutanak kaydedildi.", id: req };
  }
  const { data, error } = await supabase.rpc("stk_issue_direct", { p_employee: s(f, "employee"), p_warehouse: s(f, "warehouse") || null, p_lines: lines, p_signer: s(f, "signer") || ses.email || "Depo", p_png: w, p_employee_png: e, p_note: s(f, "note") || null });
  if (error) return { ok: false, message: bcErrorText(error.message) };
  back("/stok/teslim", "/stok/talepler", "/stok");
  return { ok: true, message: "Teslim edildi; iki imzalı tutanak kaydedildi.", id: data as string };
}

// ------------------------------------------------------------- demirbaş sayımı

export async function countStart(_: BcState | null, f: FormData): Promise<BcState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ast_count_start", { p: { title: s(f, "title"), location: s(f, "location"), category: s(f, "category") || null, note: s(f, "note") } });
  if (error) return { ok: false, message: bcErrorText(error.message) };
  back("/demirbas/sayim");
  return { ok: true, message: "Sayım başladı.", id: data as string };
}

export type CountHit = { ok: boolean; message?: string; name?: string; code?: string | null; expected?: boolean; duplicate?: boolean; moved?: boolean; location?: string | null; expected_location?: string | null };
export async function countScan(id: string, code: string, location: string, condition: string): Promise<CountHit> {
  const supabase = await createClient();
  const uuid = code.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  const { data, error } = await supabase.rpc("ast_count_scan", { p_count: id, p_code: uuid ?? code, p_location: location || null, p_condition: condition });
  if (error) return { ok: false, message: bcErrorText(error.message) };
  return { ok: true, ...(data as Omit<CountHit, "ok">) };
}

export async function countMark(item: string, found: boolean, patch: { location?: string; condition?: string; note?: string; photo?: string } = {}): Promise<BcState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("ast_count_mark", { p_item: item, p_found: found, p_location: patch.location ?? null, p_condition: patch.condition ?? null, p_note: patch.note ?? null, p_photo: patch.photo ?? null });
  if (error) return { ok: false, message: bcErrorText(error.message) };
  return { ok: true, message: "" };
}

export async function countClose(_: BcState | null, f: FormData): Promise<BcState> {
  const id = s(f, "id");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ast_count_close", { p_count: id, p_apply: f.get("apply") === "on", p_mark_lost: f.get("lost") === "on" });
  if (error) return { ok: false, message: bcErrorText(error.message) };
  back("/demirbas/sayim", `/demirbas/sayim/${id}`, "/demirbas", "/teknik-servis");
  const d = data as { moved: number; broken: number; lost: number };
  return { ok: true, message: `Sayım kapandı. ${f.get("apply") === "on" ? `Yeri güncellenen: ${d.moved}, bakıma alınan: ${d.broken}, kayıp işaretlenen: ${d.lost}.` : "Kartlara işlenmedi."}` };
}

export type OpenReq = { id: string; no: string; status: string; lines: { id: string; item_id: string | null; name: string; unit: string; qty: number; issued_qty: number }[] };
/** Personelin açık malzeme / demirbaş istekleri (okutarak teslim için) */
export async function openRequestsFor(employee: string): Promise<OpenReq[]> {
  if (!UUID.test(employee)) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("stk_requests").select("id, kind, year, no, status, stk_request_lines(id, item_id, name, unit, qty, issued_qty, sort)").eq("employee_id", employee).eq("kind", "material").in("status", ["pending", "ready"]).order("created_at");
  return ((data ?? []) as unknown as { id: string; year: number; no: number; status: string; stk_request_lines: (OpenReq["lines"][number] & { sort: number })[] }[]).map((r) => ({
    id: r.id, no: `MT-${r.year}-${String(r.no).padStart(4, "0")}`, status: r.status,
    lines: [...r.stk_request_lines].sort((a, b) => a.sort - b.sort).map((l) => ({ id: l.id, item_id: l.item_id, name: l.name, unit: l.unit, qty: Number(l.qty), issued_qty: Number(l.issued_qty) })),
  }));
}
