"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/session";

/** Dentalsis Plus'tan aktarım: dökümler documents/dentalsis/ altında (ref, jobs-NNN, tahsilat) */
export type DsisFiles = { ok: boolean; message?: string; ref: boolean; tahsilat: boolean; jobs: string[]; status: Record<string, unknown> | null };
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
    if (error) return { ok: false, message: error.message, ref: false, tahsilat: false, jobs: [], status: null };
    const names = (data ?? []).map((f) => f.name.replace(/\.json$/, ""));
    const sb = await createClient();
    const { data: st } = await sb.rpc("dsis_import_status");
    return { ok: true, ref: names.includes("ref"), tahsilat: names.includes("tahsilat"), jobs: names.filter((n) => /^jobs-\d+$/.test(n)).sort(), status: (st as Record<string, unknown>) ?? null };
  } catch (e) {
    return { ok: false, message: (e as Error).message, ref: false, tahsilat: false, jobs: [], status: null };
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
    for (let i = 0; i < jobs.length; i += 150) {
      const { data, error } = await sb.rpc("dsis_import_jobs", { p_jobs: jobs.slice(i, i + 150) });
      if (error) return { ok: false, message: `${name} (${i}. kayıttan sonra): ${sqlHint(error.message)}`, result: sum };
      for (const [k, v] of Object.entries((data ?? {}) as Record<string, number>)) sum[k] = (sum[k] ?? 0) + Number(v || 0);
    }
    return { ok: true, message: `${name}: ${sum.inserted ?? 0} iş eklendi`, result: sum };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function dsisImportBalance(): Promise<DsisStep> {
  try {
    await owner();
    const t = await readJson<{ tahsilat?: unknown[]; ekstreToplam?: unknown[] }>("tahsilat");
    const { data, error } = await (await createClient()).rpc("dsis_import_balance", { p_tahsilat: t.tahsilat ?? [], p_balances: t.ekstreToplam ?? [] });
    if (error) return { ok: false, message: sqlHint(error.message) };
    revalidatePath("/isler");
    revalidatePath("/isler/cari");
    return { ok: true, message: "Tahsilatlar aktarıldı, cari bakiyeler Dentalsis'e eşitlendi", result: data as Record<string, unknown> };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
