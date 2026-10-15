"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { refreshDespatches, sendDespatch } from "@/lib/edsp-send";

const str = (f: FormData, k: string, max = 300) => String(f.get(k) ?? "").trim().slice(0, max);
const uuid = (v: string) => (/^[0-9a-f-]{36}$/i.test(v) ? v : "");
const BASE = "/satis/e-irsaliye";

async function can() {
  const s = await getSession();
  return (s.modules.sales ?? 0) >= 2 || s.logistics;
}
function msg(m: string) {
  if (/not_allowed/.test(m)) return "Bu işlem için satış (düzenleme) ya da lojistik yetkisi gerekir.";
  if (/einv_locked|einv_already/.test(m)) return "İrsaliye eLogo'ya gönderildi ya da gönderiliyor; değiştirilemez.";
  if (/lines_required/.test(m)) return "En az bir satır girin.";
  if (/edsp_|relation|does not exist|schema cache/.test(m)) return "Supabase'de 20270227000000_einv_send.sql çalıştırılmalı.";
  if (/check constraint/.test(m)) return "Bir alan hatalı (VKN 10, TCKN 11 hane; şoför TCKN 11 hane).";
  return m;
}

export type DespatchPayload = { [k: string]: unknown; lines: Array<{ name: string; qty: number; unit: string; seller_code?: string | null; unit_price?: number | null; currency?: string | null }> };

/** Form: kaydet */
export async function edspSave(p: DespatchPayload): Promise<{ ok: boolean; id?: string; message: string }> {
  if (!(await can())) return { ok: false, message: msg("not_allowed") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("edsp_save", { p: { ...p, lines: (p.lines ?? []).slice(0, 500) } });
  if (error) return { ok: false, message: msg(error.message) };
  revalidatePath(BASE, "layout");
  return { ok: true, id: data as string, message: "e-İrsaliye kaydedildi." };
}

/** Satış faturasından e-İrsaliye taslağı */
export async function edspFromInvoice(f: FormData) {
  if (!(await can())) await fail(msg("not_allowed"));
  const id = uuid(str(f, "id", 40));
  const supabase = await createClient();
  const [{ data: inv }, { data: lines }] = await Promise.all([
    supabase.from("inv_invoices").select("id, party_id, doc_no, invoice_date, currency, delivery_address").eq("id", id).maybeSingle(),
    supabase.from("inv_lines").select("name, qty, unit, seller_code, unit_price").eq("invoice_id", id).order("sort"),
  ]);
  if (!inv) await fail("Fatura bulunamadı.");
  const { data, error } = await supabase.rpc("edsp_save", { p: {
    party_id: inv!.party_id, invoice_id: inv!.id, delivery_address: inv!.delivery_address, note: inv!.doc_no ? `${inv!.doc_no} numaralı faturaya istinaden` : null,
    lines: ((lines ?? []) as Array<{ name: string; qty: number; unit: string; seller_code: string | null; unit_price: number }>).map((l) => ({ ...l, currency: inv!.currency })),
  } });
  if (error) await fail(msg(error.message));
  revalidatePath(BASE, "layout");
  redirect(`${BASE}/${data}?tamam=${encodeURIComponent("Faturadan e-İrsaliye taslağı hazırlandı: araç / şoför bilgisini girip gönderin.")}`);
}

/** Laboratuvar irsaliyesinden (işlerden) e-İrsaliye taslağı */
export async function edspFromWaybill(f: FormData) {
  if (!(await can())) await fail(msg("not_allowed"));
  const id = uuid(str(f, "id", 40));
  const supabase = await createClient();
  const [{ data: w }, { data: jobs }] = await Promise.all([
    supabase.from("lab_waybills").select("id, customer_id, ship_date, currency, year, no").eq("id", id).maybeSingle(),
    supabase.from("jobs").select("no, patient, job_items(name, qty, unit_price, sort)").eq("waybill_id", id).order("no"),
  ]);
  if (!w) await fail("Laboratuvar irsaliyesi bulunamadı.");
  const { data: party } = await supabase.from("fin_parties").select("id").eq("lab_customer_id", w!.customer_id).maybeSingle();
  if (!party) await fail("Hekimin cari kartı bulunamadı.");
  const ls = ((jobs ?? []) as Array<{ no: number; patient: string | null; job_items: Array<{ name: string; qty: number; unit_price: number; sort: number }> }>).flatMap((j) =>
    [...(j.job_items ?? [])].sort((a, b) => a.sort - b.sort).map((it) => ({ name: `${it.name} — iş #${j.no}${j.patient ? ` · ${j.patient}` : ""}`.slice(0, 300), qty: it.qty, unit: "adet", seller_code: `IS-${j.no}`, unit_price: Number(it.unit_price) / 100, currency: w!.currency })));
  if (!ls.length) await fail("Bu irsaliyede kalem yok.");
  const { data, error } = await supabase.rpc("edsp_save", { p: { party_id: party!.id, waybill_id: w!.id, ship_date: w!.ship_date, note: `Laboratuvar irsaliyesi ${w!.year}/${w!.no}`, lines: ls } });
  if (error) await fail(msg(error.message));
  revalidatePath(BASE, "layout");
  redirect(`${BASE}/${data}?tamam=${encodeURIComponent("Laboratuvar irsaliyesinden e-İrsaliye taslağı hazırlandı: araç / şoför bilgisini girip gönderin.")}`);
}

export async function edspSend(f: FormData) {
  if (!(await can())) await fail(msg("not_allowed"));
  const id = uuid(str(f, "id", 40));
  const supabase = await createClient();
  let r: Awaited<ReturnType<typeof sendDespatch>>;
  try { r = await sendDespatch(supabase, id, { draft: str(f, "mode", 10) !== "direct" }); } catch (e) { r = { ok: false, message: `eLogo: ${(e as Error).message}`.slice(0, 280) }; }
  revalidatePath(BASE, "layout");
  if (!r.ok) await fail(r.errors && r.errors.length > 1 ? `Gönderilmedi: ${r.errors.join(" • ")}`.slice(0, 300) : r.message);
  await done(r.message);
}

export async function edspRefresh(f: FormData) {
  if (!(await can())) await fail(msg("not_allowed"));
  const id = uuid(str(f, "id", 40));
  const supabase = await createClient();
  let m = "";
  try { const r = await refreshDespatches(supabase, [id]); if (r.errors) m = "Durum alınamadı; biraz sonra yeniden deneyin."; } catch (e) { m = `eLogo: ${(e as Error).message}`; }
  revalidatePath(BASE, "layout");
  if (m) await fail(m.slice(0, 280));
  await done("Durum güncellendi.");
}

export async function edspDelete(f: FormData) {
  if (!(await can())) await fail(msg("not_allowed"));
  const id = uuid(str(f, "id", 40));
  const supabase = await createClient();
  const { error } = await supabase.rpc("edsp_delete", { p_id: id });
  if (error) await fail(msg(error.message));
  revalidatePath(BASE, "layout");
  redirect(`${BASE}?tamam=${encodeURIComponent("e-İrsaliye silindi / iptal edildi.")}`);
}
