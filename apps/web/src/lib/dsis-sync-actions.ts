"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/session";
import { dsisSyncReady, runDsisSync, type DsisSyncResult } from "@/lib/dsis-sync";

export type DsisSyncStatus = { ready: boolean; enabled: boolean; last: DsisSyncResult | null; lastOk: DsisSyncResult | null; message?: string };

async function owner() {
  const s = await getSession();
  if (s.role !== "owner") throw new Error("Yalnız şirket sahibi");
}

export async function dsisSyncStatus(): Promise<DsisSyncStatus> {
  try {
    await owner();
    const { data, error } = await createAdminClient().from("dsis_sync_state").select("key, val").in("key", ["config", "last", "last_ok"]);
    if (error) return { ready: dsisSyncReady(), enabled: false, last: null, lastOk: null, message: /dsis_sync_state/.test(error.message) ? "Önce mbdental-dentalsis-otomatik.sql dosyasını Supabase'de çalıştırın." : error.message };
    const get = (k: string) => (data ?? []).find((r) => r.key === k)?.val ?? null;
    const cfg = (get("config") as { enabled?: boolean } | null) ?? {};
    return { ready: dsisSyncReady(), enabled: cfg.enabled !== false, last: get("last") as DsisSyncResult | null, lastOk: get("last_ok") as DsisSyncResult | null };
  } catch (e) {
    return { ready: false, enabled: false, last: null, lastOk: null, message: (e as Error).message };
  }
}

export async function dsisSyncToggle(enabled: boolean): Promise<{ ok: boolean; message?: string }> {
  try {
    await owner();
    const { error } = await createAdminClient().from("dsis_sync_state").upsert({ key: "config", val: { enabled }, updated_at: new Date().toISOString() });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/isler/dentalsis-aktar");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function dsisSyncNow(): Promise<DsisSyncResult | { ok: false; message: string }> {
  try {
    await owner();
    const r = await runDsisSync(createAdminClient(), { force: true });
    revalidatePath("/isler/dentalsis-aktar");
    return r;
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
