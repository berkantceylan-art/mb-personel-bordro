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
export type DsisAuditState = { scan: { next: number; done: boolean; rows?: number; finished?: string } | null; report: DsisAuditReport | null; message?: string; partErrors?: string[] };

/** Rapor üç parçada hesaplanır ve saklanır (sayfa açılışında yeniden hesaplanmaz) */
async function buildReport(sb: ReturnType<typeof createAdminClient>): Promise<{ report: DsisAuditReport; errors: string[] }> {
  const parts: Array<[keyof DsisAuditReport | "jobs", string, string]> = [["customers", "dsis_audit_cust", "Cariler"], ["balances", "dsis_audit_bal", "Bakiyeler"], ["jobs", "dsis_audit_jobs", "İşler"]];
  const errors: string[] = [];
  const res = await Promise.all(parts.map(async ([, fn, label]) => {
    const { data, error } = await sb.rpc(fn);
    if (error) { errors.push(`${label}: ${/timeout/i.test(error.message) ? "zaman aşımı" : /function|schema cache/.test(error.message) ? "Supabase'de mbdental-dentalsis-kontrol-parcali.sql çalıştırılmalı" : error.message}`); return null; }
    return data as Record<string, unknown>;
  }));
  const [cu, ba, jo] = res;
  const report: DsisAuditReport = {
    scanned_at: (jo?.scanned_at as string | undefined) ?? undefined, cari_at: (cu?.cari_at as string | undefined) ?? undefined,
    customers: (cu ?? undefined) as DsisAuditReport["customers"], balances: (ba ?? undefined) as DsisAuditReport["balances"], jobs: (jo ?? undefined) as DsisAuditReport["jobs"],
  };
  await sb.from("dsis_sync_state").upsert({ key: "audit_report", val: { report, errors, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
  return { report, errors };
}

export async function dsisAuditState(): Promise<DsisAuditState> {
  try {
    await owner();
    const sb = createAdminClient();
    const { data: rows } = await sb.from("dsis_sync_state").select("key, val").in("key", ["audit_scan", "audit_report"]);
    const get = (k: string) => (rows ?? []).find((r) => r.key === k)?.val ?? null;
    const cached = get("audit_report") as { report: DsisAuditReport; errors: string[] } | null;
    return { scan: get("audit_scan") as DsisAuditState["scan"], report: cached?.report ?? null, partErrors: cached?.errors ?? [] };
  } catch (e) {
    return { scan: null, report: null, message: (e as Error).message };
  }
}

export async function dsisAuditRefresh(): Promise<{ ok: boolean; message: string }> {
  try {
    await owner();
    const { errors } = await buildReport(createAdminClient());
    revalidatePath("/isler/dentalsis-aktar");
    return { ok: !errors.length, message: errors.length ? `Rapor kısmen hesaplanamadı: ${errors.join(" · ")}` : "Rapor güncellendi." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function dsisAuditScanAction(restart: boolean): Promise<{ ok: boolean; message: string }> {
  try {
    await owner();
    const { dsisAuditScan } = await import("@/lib/dsis-audit");
    const sb = createAdminClient();
    const r = await dsisAuditScan(sb, restart);
    let extra = "";
    if (r.state.done) { const b = await buildReport(sb); if (b.errors.length) extra = ` Rapor: ${b.errors.join(" · ")}`; }
    revalidatePath("/isler/dentalsis-aktar");
    return { ok: r.ok, message: r.message + extra };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function dsisAuditFixAction(): Promise<{ ok: boolean; message: string }> {
  try {
    await owner();
    const { dsisAuditFix } = await import("@/lib/dsis-audit");
    const sb = createAdminClient();
    const r = await dsisAuditFix(sb);
    revalidatePath("/isler/dentalsis-aktar");
    return { ok: r.ok, message: r.message };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
