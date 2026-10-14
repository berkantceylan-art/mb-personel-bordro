"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SupState = { ok?: boolean; message: string };
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const err = (m: string) => (/fin_party_twin|slip_of/.test(m) ? "Supabase'de 20270129000000_slip_party.sql çalıştırılmalı." : /sup_|schema cache/.test(m) && /function|relation|does not exist|schema cache/.test(m) ? "Supabase'de 20270111000000_supplier_slips.sql çalıştırılmalı." : /amount_required/.test(m) ? "Tutarı girin." : /not_allowed/.test(m) ? "Yetkiniz yok." : m);

export async function saveSlip(_: SupState | null, f: FormData): Promise<SupState> {
  const party = s(f, "party_id");
  const amt = Math.round(Number(s(f, "amount").replace(/\./g, "").replace(",", ".")) * 100);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, message: "Tutarı sayı olarak yazın (ör. 1.250,50)." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("sup_slip_save", { p: { party_id: party, slip_date: s(f, "slip_date") || null, doc_no: s(f, "doc_no"), amount: amt, currency: s(f, "currency") || "TRY", receipt_id: s(f, "receipt_id") || null, note: s(f, "note"), photo: s(f, "photo") || null } });
  if (error) return { ok: false, message: err(error.message) };
  revalidatePath("/finans/fis-cari", "layout");
  revalidatePath("/finans/cariler", "layout");
  return { ok: true, message: "Fiş kaydedildi, fişli cariye borç yazıldı." };
}

export async function cancelSlip(f: FormData) {
  const supabase = await createClient();
  await supabase.rpc("sup_slip_cancel", { p_id: s(f, "id") });
  revalidatePath("/finans/fis-cari", "layout");
  revalidatePath("/finans/cariler", "layout");
}

export async function saveSlipOpening(f: FormData) {
  const party = s(f, "party_id");
  const n = Math.round(Number(s(f, "amount").replace(/\./g, "").replace(",", ".") || "0") * 100);
  const supabase = await createClient();
  await supabase.from("sup_slip_open").upsert({ party_id: party, amount: Number.isFinite(n) ? -Math.abs(n) * (s(f, "side") === "them" ? -1 : 1) : 0, as_of: s(f, "as_of") || null, updated_at: new Date().toISOString() });
  revalidatePath(`/finans/fis-cari/${party}`);
  revalidatePath("/finans/fis-cari");
}

/** Tedarikçiye fişli cari aç (varsa açılanı getirir) */
export async function openSlipParty(f: FormData) {
  const main = s(f, "cari");
  const supabase = await createClient();
  const { error } = await supabase.rpc("fin_party_twin", { p_main: main });
  if (error) redirect(`/finans/fis-cari?hata=${encodeURIComponent(err(error.message))}`);
  revalidatePath("/finans/fis-cari", "layout");
  redirect(`/finans/fis-cari/${main}`);
}
