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

// ---------------------------------------------------------------------
// Dentalsis ↔ ERP denetimi
// ---------------------------------------------------------------------
export type DsisAuditReport = {
  scanned_at?: string; cari_at?: string;
  customers?: { remote: number; linked: number; missing: number; missing_list: Array<{ id: number; name: string }>; name_diff: Array<{ id: number; remote: string; erp: string }>; erp_only: Array<{ id: string; name: string }> };
  balances?: { checked: number; mismatch: number; list: Array<{ id: string; name: string; currency: string; remote: number; erp: number; diff: number }> };
  jobs?: {
    remote: number; remote_open: number; erp_open: number; missing: number; should_close: number; should_open: number; erp_only: number;
    missing_list: Array<{ id: number; no: number; cari: string; hasta: string; tarih: string; prova: string }>;
    should_close_list: Array<{ id: number; no: number; cariad: string; hasta: string; status: string }>;
    should_open_list: Array<{ id: number; no: number; cariad: string; hasta: string; provaturu: string; status: string }>;
    erp_only_list: Array<{ id: string; no: number; legacy_id: number; patient: string; status: string }>;
  };
};
export type DsisAuditState = { scan: { next: number; done: boolean; rows?: number; finished?: string } | null; report: DsisAuditReport | null; message?: string };

export async function dsisAuditState(): Promise<DsisAuditState> {
  try {
    await owner();
    const sb = createAdminClient();
    const { data: st } = await sb.from("dsis_sync_state").select("val").eq("key", "audit_scan").maybeSingle();
    const { data: rep, error } = await sb.rpc("dsis_audit_report");
    if (error) return { scan: null, report: null, message: /dsis_audit_report|dsis_remote|schema cache/.test(error.message) ? "Önce mbdental-dentalsis-kontrol.sql dosyasını Supabase'de çalıştırın." : error.message };
    return { scan: (st?.val ?? null) as DsisAuditState["scan"], report: rep as DsisAuditReport };
  } catch (e) {
    return { scan: null, report: null, message: (e as Error).message };
  }
}

export async function dsisAuditScanAction(restart: boolean): Promise<{ ok: boolean; message: string }> {
  try {
    await owner();
    const { dsisAuditScan } = await import("@/lib/dsis-audit");
    const r = await dsisAuditScan(createAdminClient(), restart);
    revalidatePath("/isler/dentalsis-aktar");
    return { ok: r.ok, message: r.message };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function dsisAuditFixAction(): Promise<{ ok: boolean; message: string }> {
  try {
    await owner();
    const { dsisAuditFix } = await import("@/lib/dsis-audit");
    const r = await dsisAuditFix(createAdminClient());
    revalidatePath("/isler/dentalsis-aktar");
    return { ok: r.ok, message: r.message };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
