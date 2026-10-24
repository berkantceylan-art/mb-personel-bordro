"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/session";
import { allRows } from "@/lib/fetch-all";

/** Bizim Hesap cari dökümü (documents/dentalsis/bh-cariler-N.json): kart bilgileri + ekstre satırları */
export type BhRow = { date: string; due: string | null; type: string; desc: string; method: string | null; debit: number; credit: number };
export type BhCari = {
  kind: "c" | "s"; guid: string; name: string; group: string | null; currency: string; erp_balance: number; sum: number; active: string;
  info: { tax_no: string | null; tax_office: string | null; phone: string | null; phone2: string | null; email: string | null; address: string | null; authorized: string | null; iban: string | null; due_days: string | null; code1: string | null; code2: string | null; note: string | null };
  rows: BhRow[];
};
export type BhListItem = Omit<BhCari, "rows"> & {
  n: number; from: string | null; to: string | null; match: { id: string; name: string; moves: number; via: string; balance?: number; currency?: string; lab?: boolean } | null;
  /** ERP'ye aktarılmış (Bizim Hesap bağlantısı kurulmuş ya da eşleşen caride Bizim Hesap hareketi var) */
  imported: boolean;
  /** Kullanıcı "aktarılmayacak" diye listeden çıkardı */
  hidden: boolean;
};
export type BhMode = "rows" | "balance" | "card";
/** ERP'deki cari (aktarım hedefi seçimi için) */
export type BhParty = { id: string; name: string; kind: string; currency: string; tax_no: string | null };

const N = (s: string) => s.toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Gerçek VKN / TCKN mi: 10-11 hane ve Bizim Hesap'ta yer tutucu olarak girilen 1111111111, 2222222222, 1234567890 gibi değerler değil */
const realTax = (t: string | null | undefined): boolean => !!t && /^\d{10,11}$/.test(t) && !/^(\d)\1+$/.test(t) && !["1234567890", "12345678901", "0123456789"].includes(t);

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

/** Satırları ~size'lık parçalara böler; bir günün satırları hep aynı parçada kalır */
function chunkByDate(rows: BhRow[], size: number): BhRow[][] {
  const out: BhRow[][] = [];
  let cur: BhRow[] = [];
  // kararlı sıralama: aynı günün satırları yan yana gelir, kendi aralarındaki sıra korunur
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  for (const r of sorted) {
    if (cur.length >= size && cur[cur.length - 1]!.date !== r.date) { out.push(cur); cur = []; }
    cur.push(r);
  }
  if (cur.length) out.push(cur);
  return out.length ? out : [[]];
}

/** Listeden çıkarılan (aktarılmayacak) Bizim Hesap carileri: documents/dentalsis/bh-gizli.json (guid listesi) */
const HIDDEN = "dentalsis/bh-gizli.json";
async function readHidden(): Promise<Set<string>> {
  const { data } = await createAdminClient().storage.from("documents").download(HIDDEN);
  if (!data) return new Set();
  try { return new Set(JSON.parse(await data.text()) as string[]); } catch { return new Set(); }
}

export async function bhCariHide(guids: string[], hide: boolean): Promise<{ ok: boolean; message: string }> {
  try {
    await guard();
    const set = await readHidden();
    for (const g of guids.slice(0, 2000)) { if (hide) set.add(g); else set.delete(g); }
    const up = await createAdminClient().storage.from("documents").upload(HIDDEN, Buffer.from(JSON.stringify([...set])), { contentType: "application/json", upsert: true });
    if (up.error) return { ok: false, message: up.error.message };
    revalidatePath("/finans/cariler/bizimhesap");
    return { ok: true, message: hide ? `${guids.length} cari listeden çıkarıldı.` : `${guids.length} cari listeye geri alındı.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function bhCariList(): Promise<{ ok: boolean; message?: string; items?: BhListItem[]; parties?: BhParty[]; at?: string }> {
  try {
    await guard();
    const all = await readAll();
    if (!all.length) return { ok: true, items: [] };
    const sb = await createClient();
    const [{ data: parties }, { data: bals }] = await Promise.all([
      sb.from("fin_parties").select("id, name, tax_no, bh_guid, kind, currency, lab_customer_id").limit(10000),
      allRows<{ party_id: string; balance: number }>((a, b) => sb.from("fin_party_balances").select("party_id, balance").order("party_id").range(a, b)),
    ]);
    const ps = (parties ?? []) as { id: string; name: string; tax_no: string | null; bh_guid: string | null; kind: string; currency: string; lab_customer_id: string | null }[];
    const balOf = new Map<string, number>((bals ?? []).map((b) => [b.party_id, Number(b.balance)]));
    const pById = new Map(ps.map((p) => [p.id, p]));
    const byGuid = new Map(ps.filter((p) => p.bh_guid).map((p) => [p.bh_guid!, p]));
    const byTax = new Map(ps.filter((p) => realTax(p.tax_no)).map((p) => [p.tax_no!, p]));
    const byName = new Map(ps.map((p) => [N(p.name), p]));
    const matched = new Map<string, { p: { id: string; name: string }; via: string }>();
    for (const c of all) {
      const g = byGuid.get(c.guid);
      const t = realTax(c.info.tax_no) ? byTax.get(c.info.tax_no!) : undefined;
      const nm = byName.get(N(c.name));
      const hit = g ? { p: g, via: "Bizim Hesap bağlantısı" } : t ? { p: t, via: "VKN" } : nm ? { p: nm, via: "aynı ad" } : null;
      if (hit) matched.set(c.guid, hit);
    }
    // eşleşen carilerde Bizim Hesap aktarımı dışında hareket var mı
    const ids = [...new Set([...matched.values()].map((m) => m.p.id))];
    // PostgREST tek sorguda en çok 1000 satır döndürür: sayfalayarak say (aksi halde aktarılmış cariler "aktarılacak" görünür)
    const moves = new Map<string, number>();
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
    const pages = await Promise.all(chunks.map((part) => allRows<{ party_id: string; fin_txns: { ref_type: string | null } }>((a, b) =>
      sb.from("fin_moves").select("id, party_id, fin_txns!inner(ref_type, voided_at)").in("party_id", part).is("fin_txns.voided_at", null).order("id").range(a, b))));
    for (const pg of pages) {
      if (pg.error) throw new Error(pg.error.message);
      for (const m of pg.data) {
        const key = m.fin_txns?.ref_type === "bh_import" ? `${m.party_id}|bh` : m.party_id;
        moves.set(key, (moves.get(key) ?? 0) + 1);
      }
    }
    const hidden = await readHidden();
    const items: BhListItem[] = all.map(({ rows, ...c }) => {
      const m = matched.get(c.guid);
      const bhDone = !!m && (moves.get(`${m.p.id}|bh`) ?? 0) > 0;
      return {
        ...c, n: rows.length, from: rows[0]?.date ?? null, to: rows[rows.length - 1]?.date ?? null,
        match: m ? { id: m.p.id, name: m.p.name, moves: moves.get(m.p.id) ?? 0, via: m.via + (bhDone ? " · Bizim Hesap hareketleri zaten aktarılmış" : ""), balance: balOf.get(m.p.id) ?? 0, currency: pById.get(m.p.id)?.currency, lab: !!pById.get(m.p.id)?.lab_customer_id } : null,
        imported: byGuid.has(c.guid) || bhDone,
        hidden: hidden.has(c.guid),
      };
    });
    const plist: BhParty[] = ps
      .map((p) => ({ id: p.id, name: p.name, kind: p.kind, currency: p.currency, tax_no: p.tax_no }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
    return { ok: true, items, parties: plist };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Elle seçilen hedef carinin ERP'deki hareket sayısı (Bizim Hesap aktarımı hariç / dahil) */
export async function bhPartyMoves(partyId: string): Promise<{ ok: boolean; moves: number; bh: number }> {
  try {
    await guard();
    const sb = await createClient();
    const { data } = await allRows<{ fin_txns: { ref_type: string | null } }>((a, b) => sb.from("fin_moves").select("id, fin_txns!inner(ref_type, voided_at)").eq("party_id", partyId).is("fin_txns.voided_at", null).order("id").range(a, b));
    let moves = 0, bh = 0;
    for (const m of data) {
      if (m.fin_txns?.ref_type === "bh_import") bh++; else moves++;
    }
    return { ok: true, moves, bh };
  } catch {
    return { ok: false, moves: 0, bh: 0 };
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


type SB = Awaited<ReturnType<typeof createClient>>;
/**
 * Bizim Hesap carisi için KENDİ para biriminde ERP carisi bul ya da aç.
 * Eşleşme sırası: Bizim Hesap bağlantısı → VKN → ad; hepsinde para birimi tutmalı. Tutmuyorsa (ör. TL kartı var, Bizim Hesap'taki
 * Euro) ayrı kart açılır: ERP aynı VKN'yi iki karta yazmaya izin vermediği için VKN nota yazılır, ad çakışırsa "(EUR)" eki eklenir.
 */
async function ensurePartyInCurrency(sb: SB, c: BhCari): Promise<{ id: string; created: boolean; name: string }> {
  const { data: ps } = await sb.from("fin_parties").select("id, name, currency, tax_no, bh_guid").limit(10000);
  const all = (ps ?? []) as { id: string; name: string; currency: string; tax_no: string | null; bh_guid: string | null }[];
  const tax = realTax(c.info.tax_no) ? c.info.tax_no! : null;
  const same = all.find((p) => p.currency === c.currency && p.bh_guid === c.guid)
    ?? all.find((p) => p.currency === c.currency && tax && p.tax_no === tax)
    ?? all.find((p) => p.currency === c.currency && N(p.name) === N(c.name));
  if (same) {
    if (!same.bh_guid && !all.some((p) => p.bh_guid === c.guid)) await sb.from("fin_parties").update({ bh_guid: c.guid }).eq("id", same.id);
    return { id: same.id, created: false, name: same.name };
  }
  const nameTaken = all.some((p) => N(p.name) === N(c.name));
  const taxTaken = !!tax && all.some((p) => p.tax_no === tax);
  const guidTaken = all.some((p) => p.bh_guid === c.guid);
  const name = (nameTaken ? `${c.name} (${c.currency})` : c.name).slice(0, 200);
  const { data: ins, error } = await sb.from("fin_parties").insert({
    name, kind: c.kind === "s" ? "supplier" : "customer", currency: c.currency, tax_no: taxTaken ? null : tax, tax_office: c.info.tax_office,
    phone: c.info.phone ?? c.info.phone2, email: c.info.email, address: c.info.address, source: "import",
    note: taxTaken ? `VKN ${tax} (aynı firmanın başka para birimli carisi ayrı kart)` : null, bh_guid: guidTaken ? null : c.guid,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return { id: ins.id as string, created: true, name };
}

/** Seçilen carileri aç / eşleşene bağla ve ekstreyi işle */
export async function bhCariImport(picks: { guid: string; target: string; mode: BhMode }[]): Promise<{ ok: boolean; message: string; errors?: { name: string; error: string }[]; counts?: { parties: number; moves: number; skipped: number } }> {
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
        if (partyId) {
          // Hareketler hedef carinin para biriminde yazılır: farklı para birimli cariye aktarma
          const { data: tp } = await sb.from("fin_parties").select("currency").eq("id", partyId).maybeSingle();
          if (!tp) throw new Error("Hedef cari bulunamadı");
          if (p.mode !== "card" && (tp as { currency: string }).currency !== c.currency) throw new Error(`Para birimi farklı: Bizim Hesap ${c.currency}, ERP carisi ${(tp as { currency: string }).currency}`);
        }
        if (!partyId) {
          // yeni cari: Bizim Hesap'taki para biriminde bulunur ya da açılır (TL kartı varken Euro cari ayrı kart olur)
          partyId = (await ensurePartyInCurrency(sb, c)).id;
        }
        parties++;
        if (p.mode === "card") {
          await sb.from("fin_parties").update({ bh_guid: c.guid }).eq("id", partyId).is("bh_guid", null);
          continue;
        }
        // Çok hareketli carilerde tek çağrı veritabanı süre sınırını aşar: parça parça gönder.
        // Aynı gün aynı tutarlı satırlar SQL'de sırayla numaralanır (#1, #2…); bir gün iki parçaya bölünürse
        // ikinci satır "zaten var" sanılıp atlanır — bu yüzden parça yalnız gün değişiminde kesilir.
        const payloads = p.mode === "balance"
          ? [{ guid: c.guid, mode: "balance", balance: c.erp_balance, date: new Date().toISOString().slice(0, 10) }]
          : chunkByDate(c.rows, 400).map((rows) => ({ guid: c.guid, mode: "rows", rows }));
        for (const pl of payloads) {
          const { data, error } = await sb.rpc("bh_statement_import", { p_party: partyId, p: pl });
          if (error) throw new Error(/category_missing|function/.test(error.message) ? "Önce mbdental-bizimhesap-ekstre.sql dosyasını Supabase'de çalıştırın." : error.message);
          moves += Number((data as { moves?: number })?.moves ?? 0);
          skipped += Number((data as { skipped?: number })?.skipped ?? 0);
        }
      } catch (e) {
        errors.push({ name: c.name, error: (e as Error).message });
      }
    }
    revalidatePath("/finans/cariler", "layout");
    return { ok: errors.length === 0, message: `${parties} cari işlendi, ${moves} hareket aktarıldı${skipped ? `, ${skipped} hareket zaten vardı (atlandı)` : ""}${errors.length ? `, ${errors.length} caride hata` : ""}.`, errors: errors.slice(0, 30), counts: { parties, moves, skipped } };
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

/** Karşılaştırma: seçilen ERP carilerinin bakiyesini Bizim Hesap'taki bakiyeye eşitle (fark tek kayıtla kapanır) */
export async function bhEqualize(picks: { party: string; target: number; name: string }[]): Promise<{ ok: boolean; message: string; errors?: { name: string; error: string }[] }> {
  try {
    await guard();
    const sb = await createClient();
    const date = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
    let n = 0;
    const errors: { name: string; error: string }[] = [];
    for (const p of picks.slice(0, 1000)) {
      const { data, error } = await sb.rpc("bh_balance_equalize", { p_party: p.party, p_target: Math.round(p.target), p_date: date });
      if (error) errors.push({ name: p.name, error: /lab_party/.test(error.message) ? "hekim kartına bağlı: bakiyesi Dentalsis'ten eşitlenir" : /bh_balance_equalize|does not exist|schema cache/.test(error.message) ? "Supabase'de 20270286000000_bh_compare.sql çalıştırılmalı" : error.message });
      else if (Number(data)) n++;
    }
    revalidatePath("/finans/cariler/bizimhesap");
    return { ok: !errors.length, message: `${n} carinin bakiyesi Bizim Hesap'a eşitlendi.${errors.length ? ` ${errors.length} cari eşitlenemedi.` : ""}`, errors };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Bizim Hesap kasaları: ERP'de kasa hesabı açılır (aynı adla varsa açılış bakiyesi güncellenir) */
export async function bhCashAccounts(list: { name: string; currency: string; balance: number; date: string; holder?: string }[]): Promise<{ ok: boolean; message: string }> {
  try {
    const s = await getSession();
    if ((s.modules.finance ?? 0) < 2) return { ok: false, message: "Finans (düzenleme) yetkisi gerekir." };
    const sb = await createClient();
    let made = 0, upd = 0;
    for (const k of list) {
      const name = k.name.trim().slice(0, 120);
      if (!name) continue;
      const cur = ["TRY", "EUR", "USD", "GBP", "CHF"].includes(k.currency) ? k.currency : "TRY";
      const date = /^\d{4}-\d{2}-\d{2}$/.test(k.date) ? k.date : new Date().toISOString().slice(0, 10);
      const { data: ex } = await sb.from("fin_accounts").select("id").eq("kind", "cash").ilike("name", name).maybeSingle();
      if (ex) {
        const { error } = await sb.from("fin_accounts").update({ opening_balance: Math.round(k.balance), opening_date: date, currency: cur, holder_name: k.holder || null }).eq("id", ex.id);
        if (error) return { ok: false, message: `${name}: ${error.message}` };
        upd++;
      } else {
        const { error } = await sb.from("fin_accounts").insert({ kind: "cash", name, currency: cur, opening_balance: Math.round(k.balance), opening_date: date, holder_name: k.holder || null });
        if (error) return { ok: false, message: `${name}: ${error.message}` };
        made++;
      }
    }
    revalidatePath("/finans/kasa");
    revalidatePath("/finans/cariler/bizimhesap");
    return { ok: true, message: `${made} kasa açıldı, ${upd} kasanın açılış bakiyesi güncellendi.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Hedef ERP carisinin para birimini Bizim Hesap'takine çevir (kartta hareket yoksa) */
export async function bhSetPartyCurrency(partyId: string, currency: string): Promise<{ ok: boolean; message: string }> {
  try {
    await guard();
    const { error } = await (await createClient()).rpc("fin_party_set_currency", { p_party: partyId, p_cur: currency });
    if (error) {
      const m = error.message;
      return { ok: false, message: /has_moves:(\d+)/.test(m) ? `ERP carisinde ${m.match(/has_moves:(\d+)/)![1]} hareket var: para birimi değiştirilemez. “➕ Yeni cari aç” ile ${currency} carisi açın ya da önce aktarımı geri alın.`
        : /has_invoices/.test(m) ? "ERP carisinde fatura var: para birimi değiştirilemez; “➕ Yeni cari aç” ile ayrı kart açın."
        : /has_opening/.test(m) ? "ERP carisinde açılış bakiyesi var: önce cari kartından açılış bakiyesini sıfırlayın."
        : /lab_party/.test(m) ? "Hekim kartına bağlı cari: para birimi hekim kartından değiştirilir."
        : /fin_party_set_currency|does not exist|schema cache/.test(m) ? "Supabase'de 20270289000000_party_currency.sql çalıştırılmalı." : m };
    }
    revalidatePath("/finans/cariler/bizimhesap");
    return { ok: true, message: `ERP carisinin para birimi ${currency} yapıldı.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Bizim Hesap carisi için kendi para biriminde ERP carisi aç (ör. TL carisi var, Bizim Hesap'taki Euro) — hemen açılır, hareket aktarılmaz */
export async function bhCreateCurrencyParty(guid: string): Promise<{ ok: boolean; message: string; id?: string }> {
  try {
    await guard();
    const c = (await readAll()).find((x) => x.guid === guid);
    if (!c) return { ok: false, message: "Bizim Hesap carisi bulunamadı." };
    const r = await ensurePartyInCurrency(await createClient(), c);
    revalidatePath("/finans/cariler/bizimhesap");
    return { ok: true, id: r.id, message: r.created ? `${r.name} (${c.currency}) carisi açıldı ve hedef olarak seçildi; şimdi “aktar”a basın.` : `${c.currency} carisi zaten var: ${r.name}. Hedef olarak seçildi.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/**
 * Karşılaştırma ekranı: ERP'de olmayan ya da para birimi farklı Bizim Hesap carileri için kendi para biriminde ERP carisi
 * açılır ve Bizim Hesap bakiyesi tek "devir" kaydıyla aktarılır (hareketler istenirse alttaki listeden ayrıca aktarılır).
 */
export async function bhCompareCreate(guids: string[]): Promise<{ ok: boolean; message: string; errors?: { name: string; error: string }[] }> {
  try {
    await guard();
    const all = new Map((await readAll()).map((c) => [c.guid, c]));
    const sb = await createClient();
    const date = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
    let made = 0, bal = 0;
    const errors: { name: string; error: string }[] = [];
    for (const g of guids.slice(0, 500)) {
      const c = all.get(g);
      if (!c) continue;
      try {
        const r = await ensurePartyInCurrency(sb, c);
        if (r.created) made++;
        if (c.erp_balance !== 0) {
          const { data, error } = await sb.rpc("bh_statement_import", { p_party: r.id, p: { guid: c.guid, mode: "balance", balance: c.erp_balance, date } });
          if (error) throw new Error(/category_missing|function/.test(error.message) ? "Önce mbdental-bizimhesap-ekstre.sql dosyasını Supabase'de çalıştırın." : error.message);
          if (Number((data as { moves?: number })?.moves ?? 0)) bal++;
        }
      } catch (e) { errors.push({ name: c.name, error: (e as Error).message }); }
    }
    revalidatePath("/finans/cariler", "layout");
    return { ok: !errors.length, message: `${made} cari açıldı, ${bal} carinin bakiyesi aktarıldı.${errors.length ? ` ${errors.length} hata.` : ""}`, errors };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
