"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/session";

/** Bizim Hesap cari dökümü (documents/dentalsis/bh-cariler-N.json): kart bilgileri + ekstre satırları */
export type BhRow = { date: string; due: string | null; type: string; desc: string; method: string | null; debit: number; credit: number };
export type BhCari = {
  kind: "c" | "s"; guid: string; name: string; group: string | null; currency: string; erp_balance: number; sum: number; active: string;
  info: { tax_no: string | null; tax_office: string | null; phone: string | null; phone2: string | null; email: string | null; address: string | null; authorized: string | null; iban: string | null; due_days: string | null; code1: string | null; code2: string | null; note: string | null };
  rows: BhRow[];
};
export type BhListItem = Omit<BhCari, "rows"> & { n: number; from: string | null; to: string | null; match: { id: string; name: string; moves: number; via: string } | null };
export type BhMode = "rows" | "balance" | "card";

const N = (s: string) => s.toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

async function guard() {
  const s = await getSession();
  if (!((s.modules.finance ?? 0) >= 2 || (s.modules.sales ?? 0) >= 2 || (s.modules.purchases ?? 0) >= 2)) throw new Error("Cari aktarma yetkiniz yok.");
}

async function readAll(): Promise<BhCari[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("documents").list("dentalsis", { limit: 1000, search: "bh-cariler" });
  if (error) throw new Error(error.message);
  const names = (data ?? []).map((f) => f.name).filter((n) => /^bh-cariler-\d+\.json$/.test(n)).sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
  const out: BhCari[] = [];
  for (const n of names) {
    const { data: blob, error: e } = await admin.storage.from("documents").download(`dentalsis/${n}`);
    if (e || !blob) throw new Error(`Döküm okunamadı (${n})`);
    out.push(...(JSON.parse(await blob.text()) as BhCari[]));
  }
  return out;
}

export async function bhCariList(): Promise<{ ok: boolean; message?: string; items?: BhListItem[]; at?: string }> {
  try {
    await guard();
    const all = await readAll();
    if (!all.length) return { ok: true, items: [] };
    const sb = await createClient();
    const { data: parties } = await sb.from("fin_parties").select("id, name, tax_no, bh_guid").limit(10000);
    const ps = (parties ?? []) as { id: string; name: string; tax_no: string | null; bh_guid: string | null }[];
    const byGuid = new Map(ps.filter((p) => p.bh_guid).map((p) => [p.bh_guid!, p]));
    const byTax = new Map(ps.filter((p) => p.tax_no).map((p) => [p.tax_no!, p]));
    const byName = new Map(ps.map((p) => [N(p.name), p]));
    const matched = new Map<string, { p: { id: string; name: string }; via: string }>();
    for (const c of all) {
      const g = byGuid.get(c.guid);
      const t = c.info.tax_no && (c.info.tax_no.length === 10 || c.info.tax_no.length === 11) ? byTax.get(c.info.tax_no) : undefined;
      const nm = byName.get(N(c.name));
      const hit = g ? { p: g, via: "Bizim Hesap bağlantısı" } : t ? { p: t, via: "VKN" } : nm ? { p: nm, via: "aynı ad" } : null;
      if (hit) matched.set(c.guid, hit);
    }
    // eşleşen carilerde Bizim Hesap aktarımı dışında hareket var mı
    const ids = [...new Set([...matched.values()].map((m) => m.p.id))];
    const moves = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await sb.from("fin_moves").select("party_id, fin_txns!inner(ref_type, voided_at)").in("party_id", ids.slice(i, i + 200)).is("fin_txns.voided_at", null).limit(20000);
      for (const m of (data ?? []) as unknown as { party_id: string; fin_txns: { ref_type: string | null } }[]) {
        const key = m.fin_txns?.ref_type === "bh_import" ? `${m.party_id}|bh` : m.party_id;
        moves.set(key, (moves.get(key) ?? 0) + 1);
      }
    }
    const items: BhListItem[] = all.map(({ rows, ...c }) => {
      const m = matched.get(c.guid);
      return {
        ...c, n: rows.length, from: rows[0]?.date ?? null, to: rows[rows.length - 1]?.date ?? null,
        match: m ? { id: m.p.id, name: m.p.name, moves: moves.get(m.p.id) ?? 0, via: m.via + ((moves.get(`${m.p.id}|bh`) ?? 0) > 0 ? " · Bizim Hesap hareketleri zaten aktarılmış" : "") } : null,
      };
    });
    return { ok: true, items };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function bhCariRows(guid: string): Promise<{ ok: boolean; rows?: BhRow[]; message?: string }> {
  try {
    await guard();
    const c = (await readAll()).find((x) => x.guid === guid);
    return c ? { ok: true, rows: c.rows } : { ok: false, message: "Cari bulunamadı" };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Seçilen carileri aç / eşleşene bağla ve ekstreyi işle */
export async function bhCariImport(picks: { guid: string; target: string; mode: BhMode }[]): Promise<{ ok: boolean; message: string; errors?: { name: string; error: string }[] }> {
  try {
    await guard();
    if (!picks.length) return { ok: false, message: "Aktarılacak cari seçin." };
    const all = new Map((await readAll()).map((c) => [c.guid, c]));
    const sb = await createClient();
    let parties = 0, moves = 0, skipped = 0;
    const errors: { name: string; error: string }[] = [];
    for (const p of picks.slice(0, 1000)) {
      const c = all.get(p.guid);
      if (!c) continue;
      try {
        let partyId = p.target !== "new" ? p.target : null;
        const info = { name: c.name, tax_no: c.info.tax_no, tax_office: c.info.tax_office, phone: c.info.phone ?? c.info.phone2, email: c.info.email, address: c.info.address, currency: c.currency, source: "import" };
        if (!partyId) {
          const { data, error } = await sb.rpc("fin_party_ensure", { p: info, p_role: c.kind === "s" ? "supplier" : "customer" });
          if (error) throw new Error(error.message);
          partyId = data as string;
        }
        parties++;
        if (p.mode === "card") {
          await sb.from("fin_parties").update({ bh_guid: c.guid }).eq("id", partyId).is("bh_guid", null);
          continue;
        }
        const { data, error } = await sb.rpc("bh_statement_import", {
          p_party: partyId,
          p: p.mode === "balance" ? { guid: c.guid, mode: "balance", balance: c.erp_balance, date: new Date().toISOString().slice(0, 10) } : { guid: c.guid, mode: "rows", rows: c.rows },
        });
        if (error) throw new Error(/category_missing|function/.test(error.message) ? "Önce mbdental-bizimhesap-ekstre.sql dosyasını Supabase'de çalıştırın." : error.message);
        moves += Number((data as { moves?: number })?.moves ?? 0);
        skipped += Number((data as { skipped?: number })?.skipped ?? 0);
      } catch (e) {
        errors.push({ name: c.name, error: (e as Error).message });
      }
    }
    revalidatePath("/finans/cariler", "layout");
    return { ok: errors.length === 0, message: `${parties} cari işlendi, ${moves} hareket aktarıldı${skipped ? `, ${skipped} hareket zaten vardı (atlandı)` : ""}${errors.length ? `, ${errors.length} caride hata` : ""}.`, errors: errors.slice(0, 30) };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function bhCariUndo(partyId: string): Promise<{ ok: boolean; message: string }> {
  try {
    await guard();
    const { data, error } = await (await createClient()).rpc("bh_statement_undo", { p_party: partyId });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/finans/cariler", "layout");
    return { ok: true, message: `${data} Bizim Hesap hareketi geri alındı.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
