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

/** Var olan cariyi firmanın fişli carisi olarak bağla */
export async function linkSlipParty(f: FormData) {
  const main = s(f, "main"), slip = s(f, "slip"), kind = s(f, "kind") === "nodisc" ? "nodisc" : "slip";
  if (!main || !slip) redirect(`/finans/fis-cari?hata=${encodeURIComponent("Faturalı cariyi ve fişli cariyi seçin.")}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("sup_link_slip", { p_main: main, p_slip: slip, p_kind: kind });
  if (error) {
    const m = error.message;
    const msg = /slip_exists/.test(m) ? "Bu firmanın zaten bir fişli carisi var: ikincisini “İskontosuz / ikinci fişli” olarak bağlayın."
      : /nodisc_exists/.test(m) ? "Bu firmanın zaten iskontosuz / ikinci fişli carisi var."
      : /same_party/.test(m) ? "Aynı cari seçildi."
      : /main_is_slip/.test(m) ? "Faturalı cari olarak seçilen kart zaten başka firmanın fişli carisi."
      : /slip_has_children/.test(m) ? "Fişli cari olarak seçilen kartın kendi fişli carileri var; önce onları ayırın."
      : /sup_link_slip|does not exist|schema cache/.test(m) ? "Supabase'de 20270284000000_slip_link.sql çalıştırılmalı." : err(m);
    redirect(`/finans/fis-cari?hata=${encodeURIComponent(msg)}`);
  }
  revalidatePath("/finans/fis-cari", "layout");
  redirect(`/finans/fis-cari/${main}?tamam=${encodeURIComponent("Fişli cari bağlandı.")}`);
}
