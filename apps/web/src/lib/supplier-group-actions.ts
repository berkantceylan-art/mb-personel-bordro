"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Tedarikçi cari grubu: fişli (iskontolu) + iskontosuz fişli + KDV carisi, kalemli fiş, iskonto, ekstre aktarımı */

export type GroupState = { ok?: boolean; message: string };
const MIG = "20270267000000_supplier_cari_group.sql";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function err(m: string): string {
  if (/sup_group|sup_slip_entry|sup_statement|sup_discount|sup_item_price|sub_kind|schema cache/.test(m) && /function|column|does not exist|schema cache/.test(m)) return `Supabase'de ${MIG} çalıştırılmalı.`;
  if (/not_allowed/.test(m)) return "Yetkiniz yok.";
  if (/twin_has_moves|nodisc_has_moves/.test(m)) return "Hareketi olan carinin para birimi değiştirilemez. Fişli cari boşken para birimini seçin.";
  if (/nodisc_missing/.test(m)) return "İskontosuz fişli cari açılmamış. Önce Grup ayarlarından açın.";
  if (/group_member_missing:(\w+)/.test(m)) return `Cari grubu eksik (${m.match(/group_member_missing:(\w+)/)![1]}). Önce Grup ayarlarından iskontosuz fişli ve KDV carisini açın.`;
  if (/rate_missing:(\w+)/.test(m)) return `${m.match(/rate_missing:(\w+)/)![1]} kuru yok. Finans › Döviz kurları'ndan TCMB kurlarını çekin.`;
  if (/lines_required/.test(m)) return "En az bir kalem girin (ürün ve miktar).";
  if (/amount_required/.test(m)) return "Tutar sıfırdan büyük olmalı.";
  if (/warehouse_required/.test(m)) return "Stoğa eklemek için önce bir depo tanımlayın.";
  if (/main_required/.test(m)) return "Grup, firmanın faturalı (asıl) carisinden kurulur.";
  return m;
}

function done(main: string) {
  revalidatePath(`/finans/fis-cari/${main}`, "layout");
  revalidatePath("/finans/fis-cari");
  revalidatePath("/finans/cariler", "layout");
}

export async function setupGroup(_: GroupState | null, f: FormData): Promise<GroupState> {
  const main = s(f, "main");
  const pct = Number(s(f, "discount").replace(",", ".") || "0");
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, message: "İskonto oranı 0 ile 100 arasında olmalı." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("sup_group_setup", {
    p_main: main, p_slip_currency: s(f, "currency") || "TRY", p_discount: pct, p_nodisc: f.get("nodisc") === "on", p_vat: f.get("vat") === "on",
  });
  if (error) return { ok: false, message: err(error.message) };
  done(main);
  return { ok: true, message: "Cari grubu kaydedildi." };
}

export type ItemRouteRow = { supplier_name: string; route: "slip" | "nodisc"; price?: number | null; currency?: string; unit?: string | null; is_active?: boolean };

export async function saveItemRoutes(main: string, rows: ItemRouteRow[]): Promise<GroupState> {
  if (!rows.length) return { ok: true, message: "Değişiklik yok." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sup_item_price_save", { p_main: main, p: rows });
  if (error) return { ok: false, message: err(error.message) };
  done(main);
  return { ok: true, message: `${data ?? rows.length} ürün güncellendi.` };
}

export type EntryLine = { item_id?: string | null; name: string; qty: number; unit?: string | null; price?: number | null; currency?: string; route?: "slip" | "nodisc" };
export type EntryResult = { ok: boolean; message: string; slips?: { slip_id: string; party: string; role: string; amount: number; currency: string }[] };

export async function saveSlipEntry(p: { party_id: string; slip_date: string; doc_no: string; note: string; photo?: string | null; add_stock: boolean; warehouse_id?: string | null; lines: EntryLine[] }): Promise<EntryResult> {
  const lines = p.lines.filter((l) => l.name.trim() && Number(l.qty) !== 0);
  if (!lines.length) return { ok: false, message: "En az bir kalem girin (ürün ve miktar)." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sup_slip_entry", { p: { ...p, lines } });
  if (error) return { ok: false, message: err(error.message) };
  done(p.party_id);
  revalidatePath("/stok", "layout");
  const slips = (data ?? []) as EntryResult["slips"];
  return { ok: true, message: "Fiş kaydedildi.", slips };
}

export async function postDiscount(_: GroupState | null, f: FormData): Promise<GroupState> {
  const party = s(f, "party_id");
  const amt = Math.round(Number(s(f, "amount").replace(/\./g, "").replace(",", ".")) * 100);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, message: "İskonto tutarını sayı olarak yazın (ör. 6.319,00)." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("sup_discount_post", { p_party: party, p_date: s(f, "date") || null, p_amount: amt, p_note: s(f, "note") || "İskonto", p_doc: s(f, "doc") || null });
  if (error) return { ok: false, message: err(error.message) };
  done(s(f, "main") || party);
  return { ok: true, message: "İskonto fişli cariye işlendi." };
}

export async function statementOverlap(main: string, from: string, to: string): Promise<Record<string, number> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sup_statement_overlap", { p_main: main, p_from: from, p_to: to });
  if (error) return null;
  return (data ?? {}) as Record<string, number>;
}

export type ImportResult = { ok: boolean; message: string; counts?: Record<string, number> };

export async function importStatement(main: string, payload: unknown): Promise<ImportResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sup_statement_import", { p_main: main, p: payload });
  if (error) return { ok: false, message: err(error.message) };
  done(main);
  revalidatePath("/stok", "layout");
  return { ok: true, message: "Ekstre aktarıldı.", counts: data as Record<string, number> };
}

export async function vatBackfill(_: GroupState | null, f: FormData): Promise<GroupState> {
  const main = s(f, "main");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sup_vat_backfill", { p_main: main, p_from: s(f, "from") || null });
  if (error) return { ok: false, message: err(error.message) };
  done(main);
  return { ok: true, message: data ? `${data} faturanın KDV'si KDV carisine yazıldı.` : "Yazılacak fatura bulunamadı (KDV'si zaten yazılmış ya da ekstreden aktarılmış)." };
}
