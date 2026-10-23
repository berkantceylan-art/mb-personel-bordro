"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/session";

/** Dentalsis Plus'tan aktarım: dökümler documents/dentalsis/ altında (ref, jobs-NNN, tahsilat) */
export type DsisFiles = { ok: boolean; message?: string; ref: boolean; tahsilat: boolean; years: boolean; jobs: string[]; status: Record<string, unknown> | null };
export type DsisStep = { ok: boolean; message: string; result?: Record<string, unknown> };

async function owner() {
  const s = await getSession();
  if (s.role !== "owner") throw new Error("Aktarımı yalnız şirket sahibi yapabilir.");
  return s;
}

async function readJson<T>(name: string): Promise<T> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("documents").download(`dentalsis/${name}.json`);
  if (error || !data) throw new Error(`Döküm okunamadı (${name}): ${error?.message ?? "yok"}`);
  return JSON.parse(await data.text()) as T;
}

export async function dsisFiles(): Promise<DsisFiles> {
  try {
    await owner();
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from("documents").list("dentalsis", { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (error) return { ok: false, message: error.message, ref: false, tahsilat: false, years: false, jobs: [], status: null };
    const names = (data ?? []).map((f) => f.name.replace(/\.json$/, ""));
    const sb = await createClient();
    const { data: st } = await sb.rpc("dsis_import_status");
    return { ok: true, ref: names.includes("ref"), tahsilat: names.includes("tahsilat"), years: names.includes("yillik"), jobs: names.filter((n) => /^jobs-\d+$/.test(n)).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))), status: (st as Record<string, unknown>) ?? null };
  } catch (e) {
    return { ok: false, message: (e as Error).message, ref: false, tahsilat: false, years: false, jobs: [], status: null };
  }
}

const sqlHint = (m: string) => (/function .*dsis_|does not exist|schema cache/i.test(m) ? "Önce mbdental-dentalsis-aktarim.sql dosyasını Supabase'de çalıştırın." : m);

export async function dsisImportRef(): Promise<DsisStep> {
  try {
    await owner();
    const ref = await readJson<{ cari?: unknown[]; stok?: unknown[] }>("ref");
    const { data, error } = await (await createClient()).rpc("dsis_import_ref", { p_cari: ref.cari ?? [], p_stok: ref.stok ?? [] });
    if (error) return { ok: false, message: sqlHint(error.message) };
    return { ok: true, message: "Hekim / hastane ve ürünler aktarıldı", result: data as Record<string, unknown> };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function dsisImportBatch(name: string): Promise<DsisStep> {
  try {
    await owner();
    if (!/^jobs-\d{1,4}$/.test(name)) return { ok: false, message: "Geçersiz parti" };
    const jobs = await readJson<unknown[]>(name);
    const sb = await createClient();
    const sum: Record<string, number> = {};
    let syncOk = true;
    for (let i = 0; i < jobs.length; i += 150) {
      const part = jobs.slice(i, i + 150);
      const { data, error } = await sb.rpc("dsis_import_jobs", { p_jobs: part });
      if (error) return { ok: false, message: `${name} (${i}. kayıttan sonra): ${sqlHint(error.message)}`, result: sum };
      for (const [k, v] of Object.entries((data ?? {}) as Record<string, number>)) sum[k] = (sum[k] ?? 0) + Number(v || 0);
      // Daha önce aktarılmış işleri Dentalsis'teki son haline getir (silinen → iptal, kalem / tutar, durum)
      if (syncOk) {
        const { data: d2, error: e2 } = await sb.rpc("dsis_sync_jobs", { p_jobs: part });
        if (e2) syncOk = false;
        else for (const [k, v] of Object.entries((d2 ?? {}) as Record<string, number>)) sum[k] = (sum[k] ?? 0) + Number(v || 0);
      }
    }
    return { ok: true, message: `${name}: ${sum.inserted ?? 0} iş eklendi${sum.items_updated ? `, ${sum.items_updated} iş güncellendi` : ""}${syncOk ? "" : " (güncelleme için mbdental-dentalsis-esitle.sql çalıştırılmalı)"}`, result: sum };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 2016–2025 hekim bazında yıllık ciro / tahsilat özeti (yillik.json) */
export async function dsisImportYears(): Promise<DsisStep> {
  try {
    await owner();
    const rows = await readJson<unknown[]>("yillik");
    const sb = await createClient();
    const sum: Record<string, number> = {};
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await sb.rpc("dsis_set_year_summary", { p: rows.slice(i, i + 500) });
      if (error) return { ok: false, message: /dsis_set_year_summary|schema cache|does not exist/.test(error.message) ? "Önce mbdental-dentalsis-esitle.sql dosyasını Supabase'de çalıştırın." : error.message };
      for (const [k, v] of Object.entries((data ?? {}) as Record<string, number>)) sum[k] = (sum[k] ?? 0) + Number(v || 0);
    }
    return { ok: true, message: "2016–2025 yıllık özet aktarıldı", result: sum };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function dsisImportBalance(): Promise<DsisStep> {
  try {
    await owner();
    const t = await readJson<{ tahsilat?: unknown[]; ekstreToplam?: unknown[] }>("tahsilat");
    // parça parça (tek çağrı süre sınırını aşıyordu)
    const { balanceChunks } = await import("@/lib/dsis-sync");
    let data: unknown;
    try { data = await balanceChunks(await createClient(), (t.tahsilat ?? []) as Parameters<typeof balanceChunks>[1], (t.ekstreToplam ?? []) as Parameters<typeof balanceChunks>[2]); }
    catch (e) { return { ok: false, message: sqlHint((e as Error).message) }; }
    revalidatePath("/isler");
    revalidatePath("/isler/cari");
    return { ok: true, message: "Tahsilatlar aktarıldı, cari bakiyeler Dentalsis'e eşitlendi", result: data as Record<string, unknown> };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

const payHint = (m: string) => (/dsis_payments_|dsis_day|schema cache/i.test(m) ? "Önce mbdental-dentalsis-tahsilat.sql dosyasını Supabase'de çalıştırın." : m);

export type DsisPayPreview = { dsis_rows: number; dup_extra: number; dup_customers: number; dsis_total_eur: number; dsis_total_try: number; linked_to_finance: number; manual_2026: number;
  manual_like: { hekim: string; tarih: string; tutar: number; currency: string; not_: string | null }[] };

/** Dentalsis'ten gelen tahsilatlarda çift kayıt kontrolü (değişiklik yapmaz) */
export async function dsisPaymentsPreview(): Promise<{ ok: boolean; message?: string; data?: DsisPayPreview }> {
  try {
    await owner();
    const { data, error } = await (await createClient()).rpc("dsis_payments_preview");
    if (error) return { ok: false, message: payHint(error.message) };
    return { ok: true, data: data as DsisPayPreview };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Dentalsis tahsilatlarını silip her birini bir kez yeniden yazar, bakiyeleri yeniden eşitler */
export async function dsisPaymentsRebuild(): Promise<DsisStep> {
  try {
    await owner();
    const { data, error } = await (await createClient()).rpc("dsis_payments_reset");
    if (error) return { ok: false, message: payHint(error.message) };
    const del = Number((data as { deleted?: number } | null)?.deleted ?? 0);
    const r = await dsisImportBalance();
    if (!r.ok) return { ok: false, message: `${del} eski tahsilat silindi ama yeniden aktarım başarısız: ${r.message}. "Tahsilatları yeniden aktar" düğmesine tekrar basın.` };
    return { ok: true, message: `${del.toLocaleString("tr-TR")} eski tahsilat kaydı silindi; tahsilatlar bir kez yeniden yazıldı ve bakiyeler Dentalsis'e eşitlendi`, result: r.result };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

const cariHint = (m: string) => (/cari_model_|schema cache/i.test(m) ? "Önce mbdental-cari-duzeni.sql dosyasını Supabase'de çalıştırın." : m);

export type CariPreview = { customers: number; already: number; no_invoice: number; parties_linked: number; customers_without_party: number; invoices: number;
  unlinked_parties: { name: string; kind: string; currency: string }[]; openings: { name: string; amount: number; currency: string }[];
  payments_both: number; payments_official: number; payments_internal: number };

/** Hekim carisi + cari kart düzenine geçiş: önizleme (değişiklik yapmaz) */
export async function cariModelPreview(): Promise<{ ok: boolean; message?: string; data?: CariPreview }> {
  try {
    await owner();
    const { data, error } = await (await createClient()).rpc("cari_model_preview");
    if (error) return { ok: false, message: cariHint(error.message) };
    return { ok: true, data: data as CariPreview };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Geçişi uygula; ardından Dentalsis tahsilatlarını bu düzende yeniden yazıp bakiyeleri eşitler */
export async function cariModelApply(resetOpening: boolean): Promise<DsisStep> {
  try {
    await owner();
    const sb = await createClient();
    const { data, error } = await sb.rpc("cari_model_apply", { p_reset_opening: resetOpening });
    if (error) return { ok: false, message: cariHint(error.message) };
    const r = data as { customers: number; payments: number; openings_reset: number };
    const re = await dsisPaymentsRebuild();
    revalidatePath("/finans/cariler");
    return { ok: re.ok, message: `${r.customers} hekim yeni düzene geçti, ${r.payments} tahsilatın defteri ayarlandı${r.openings_reset ? `, ${r.openings_reset} cari kartın açılış bakiyesi sıfırlandı` : ""}. ${re.message}`, result: re.result };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ---------------------------------------------------------------------
// Aktarım sonrası düzenlemeler (para birimi, toplu kapatma, kur, ürün çevirisi, stok)
// ---------------------------------------------------------------------
const fixHint = (m: string) => (/dsis_close_old|dsis_fix|fx_rates_missing|lab_products_set_tr|dsis_products_to_stock|dsis_revenue_summary|name_tr|schema cache/i.test(m) ? "Önce mbdental-dentalsis-duzenleme.sql dosyasını Supabase'de çalıştırın." : m);

/** 2026 başından bugüne eksik TCMB kurlarını doldurur (her çağrıda en çok 25 gün) */
export async function dsisFxBackfill(from = "2026-01-01"): Promise<DsisStep & { left?: number; next?: string }> {
  try {
    await owner();
    const sb = await createClient();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = "2026-01-01";
    const { data, error } = await sb.rpc("fx_rates_missing", { p_from: from, p_to: new Date().toISOString().slice(0, 10) });
    if (error) return { ok: false, message: fixHint(error.message) };
    const days = ((data ?? []) as string[]).slice(0, 25);
    const { fetchTcmbDate } = await import("@/lib/tcmb");
    const admin = createAdminClient();
    let got = 0, none = 0;
    for (const d of days) {
      const r = await fetchTcmbDate(d).catch(() => null);
      if (!r || !r.rates.length) { none++; continue; }
      const { error: e2 } = await admin.from("fx_rates").upsert(r.rates.map((x) => ({ rate_date: d, currency: x.currency, buying: x.buying, selling: x.selling, source: "tcmb" })));
      if (!e2) got++;
    }
    const left = Math.max(0, ((data ?? []) as string[]).length - days.length);
    const last = days[days.length - 1];
    const next = last ? new Date(Date.parse(`${last}T12:00:00Z`) + 86400000).toISOString().slice(0, 10) : undefined;
    return { ok: true, message: `Kurlar: ${got} gün eklendi${none ? `, ${none} gün yayın yok (tatil)` : ""}${left ? `, ${left} gün kaldı` : ""}`, left, next };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function dsisFixCurrencyBatch(name: string): Promise<DsisStep> {
  try {
    await owner();
    if (!/^jobs-\d{1,4}$/.test(name)) return { ok: false, message: "Geçersiz parti" };
    const jobs = await readJson<{ id: number; stoklar?: unknown[] }[]>(name);
    const slim = jobs.map((j) => ({ id: j.id, stoklar: j.stoklar ?? [] }));
    const sb = await createClient();
    const sum: Record<string, number> = {};
    for (let i = 0; i < slim.length; i += 500) {
      const { data, error } = await sb.rpc("dsis_fix_currency", { p_jobs: slim.slice(i, i + 500) });
      if (error) return { ok: false, message: fixHint(error.message) };
      for (const [k, v] of Object.entries((data ?? {}) as Record<string, number>)) sum[k] = (sum[k] ?? 0) + Number(v || 0);
    }
    return { ok: true, message: `${name}: ${sum.fixed ?? 0} işin para birimi düzeltildi`, result: sum };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

async function rpcStep(fn: string, args: Record<string, unknown>, label: string): Promise<DsisStep> {
  try {
    await owner();
    const { data, error } = await (await createClient()).rpc(fn, args);
    if (error) return { ok: false, message: fixHint(error.message) };
    return { ok: true, message: label, result: data as Record<string, unknown> };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function dsisFixCustomerCurrency() { return rpcStep("dsis_fix_customer_currency", {}, "Hekim para birimleri işlerine göre düzeltildi"); }
export async function dsisCloseOld() {
  const r = await rpcStep("dsis_close_old", {}, "Bugünden önceki açık işler teslim edildi olarak kapatıldı");
  revalidatePath("/isler");
  return r;
}
export async function dsisProductsToStock() {
  const r = await rpcStep("dsis_products_to_stock", {}, "Ürünlerin stok kartları açıldı");
  revalidatePath("/stok");
  return r;
}

export async function dsisTranslateProducts(): Promise<DsisStep & { left?: number }> {
  try {
    await owner();
    const { translateMissing } = await import("@/lib/product-tr");
    const r = await translateMissing(await createClient(), 120);
    revalidatePath("/isler/urunler");
    return { ok: true, message: `Türkçe karşılık: ${r.done} ürün çevrildi${r.left ? `, ${r.left} kaldı` : ""}`, left: r.left };
  } catch (e) {
    return { ok: false, message: fixHint((e as Error).message) };
  }
}

export async function dsisRevenueSummary(): Promise<Record<string, unknown> | null> {
  try {
    await owner();
    const { data, error } = await (await createClient()).rpc("dsis_revenue_summary");
    if (error) return { error: /timeout/i.test(error.message) ? "Ciro analizi zaman aşımına uğradı: Supabase'de 20270287000000_dsis_revenue_fast.sql çalıştırılmalı." : error.message };
    return (data as Record<string, unknown>) ?? { error: "Ciro analizini yalnız şirket sahibi görebilir." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function dsisFixCountry(): Promise<DsisStep> {
  try {
    await owner();
    const ref = await readJson<{ cari?: unknown[] }>("ref");
    const { data, error } = await (await createClient()).rpc("dsis_fix_customer_country", { p_cari: ref.cari ?? [] });
    if (error) return { ok: false, message: fixHint(error.message) };
    return { ok: true, message: "Yabancı hekimler işaretlendi (ülke Dentalsis'ten)", result: data as Record<string, unknown> };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
