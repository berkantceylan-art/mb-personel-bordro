"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import type { BhParty } from "@/lib/bh-party";

const N = (s: string) => s.toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

async function guard() {
  const s = await getSession();
  if (!((s.modules.finance ?? 0) >= 2 || (s.modules.sales ?? 0) >= 2 || (s.modules.purchases ?? 0) >= 2)) throw new Error("Cari açma yetkiniz yok.");
}

/** Hangi satırlar ERP'de zaten var (VKN ya da aynı ad) */
export async function bhPartyMatch(rows: { key: string; name: string; tax_no: string | null }[]): Promise<{ ok: boolean; message?: string; match?: Record<string, string> }> {
  try {
    await guard();
    const { data, error } = await (await createClient()).from("fin_parties").select("id, name, tax_no").limit(10000);
    if (error) return { ok: false, message: error.message };
    const byTax = new Map((data ?? []).filter((p) => p.tax_no).map((p) => [p.tax_no as string, p.name as string]));
    const byName = new Map((data ?? []).map((p) => [N(p.name as string), p.name as string]));
    const match: Record<string, string> = {};
    for (const r of rows) {
      const hit = (r.tax_no && byTax.get(r.tax_no)) || byName.get(N(r.name));
      if (hit) match[r.key] = hit;
    }
    return { ok: true, match };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Seçilen carileri aç (varsa eksik bilgileri tamamlanır, kartı bozulmaz) */
export async function bhPartyImport(rows: (BhParty & { role: "customer" | "supplier" })[]): Promise<{ ok: boolean; message: string; errors?: { name: string; error: string }[] }> {
  try {
    await guard();
    if (!rows.length) return { ok: false, message: "Aktarılacak cari seçin." };
    const sb = await createClient();
    let n = 0;
    const errors: { name: string; error: string }[] = [];
    for (const r of rows.slice(0, 3000)) {
      const { error } = await sb.rpc("fin_party_ensure", {
        p: { name: r.name, tax_no: r.tax_no, tax_office: r.tax_office, phone: r.phone, email: r.email, address: r.address, city: r.city, district: r.district, currency: r.currency ?? "TRY", source: "import" },
        p_role: r.role === "supplier" ? "supplier" : "customer",
      });
      if (error) errors.push({ name: r.name, error: error.message }); else n++;
    }
    revalidatePath("/finans/cariler");
    return { ok: errors.length === 0, message: `${n} cari aktarıldı${errors.length ? `, ${errors.length} cari aktarılamadı` : ""}. Var olan carilerde yalnız boş bilgiler tamamlandı.`, errors: errors.slice(0, 30) };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
