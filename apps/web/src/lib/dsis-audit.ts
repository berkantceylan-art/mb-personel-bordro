import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/fetch-all";
import { arr, balanceChunks, client, getState, pool, rpc, setState, slimJob, sum, TokenError, type Json, type Row } from "@/lib/dsis-sync";

/**
 * Dentalsis ↔ ERP denetimi.
 *  scan: Dentalsis'teki cariler, cari bakiyeleri ve 2026'dan bu yana tüm iş kayıtları (sayfalı liste) okunup
 *        dsis_remote_* tablolarına yazılır. Uzun sürerse kaldığı sayfadan devam eder.
 *  fix : ERP'de olmayan işler ile durumu farklı işlerin ayrıntısı çekilip aktarılır / eşitlenir; bakiyeler eşitlenir.
 */
const START = "2026-01-01";
const SCAN_DEADLINE = 230_000;
const FIX_BUDGET = 260;

type ScanState = { next: number; done: boolean; started: string; finished?: string; pages?: number; rows?: number; oldest?: string };

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export async function dsisAuditScan(sb: SupabaseClient, restart = false): Promise<{ ok: boolean; message: string; state: ScanState }> {
  const t0 = Date.now();
  const call = client(sb, (await getState<{ t: string }>(sb, "token"))?.t ?? null);
  let st = (await getState<ScanState>(sb, "audit_scan")) ?? null;
  if (restart || !st || st.done) st = { next: 1, done: false, started: new Date().toISOString(), pages: 0, rows: 0 };

  // cariler ve bakiyeleri her taramada baştan okunur
  if (st.next === 1) {
    const [cari, bal] = await Promise.all([call("/cari").then(arr), call("/cari-ekstre-toplam").then(arr)]);
    const balOf = new Map(bal.map((b) => [Number(b.id), b]));
    const ids = new Set<number>();
    const rows = cari.filter((c) => c && c.id).map((c) => {
      const b = balOf.get(Number(c.id));
      ids.add(Number(c.id));
      return { id: Number(c.id), name: str(c.cariad), tl: b ? Number(b.tltutar ?? 0) : null, eur: b ? Number(b.eurotutar ?? 0) : null, usd: b ? Number(b.usdtutar ?? 0) : null, raw: c, seen_at: new Date().toISOString() };
    });
    // bakiye listesinde olup cari listesinde olmayanlar da (silinmiş / pasif cari) eklenir
    for (const b of bal) if (b && b.id && !ids.has(Number(b.id))) rows.push({ id: Number(b.id), name: str(b.cariad), tl: Number(b.tltutar ?? 0), eur: Number(b.eurotutar ?? 0), usd: Number(b.usdtutar ?? 0), raw: b, seen_at: new Date().toISOString() });
    await sb.from("dsis_remote_cari").delete().gte("id", -1);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from("dsis_remote_cari").upsert(rows.slice(i, i + 500));
      if (error) throw new Error(/dsis_remote/.test(error.message) ? "Önce mbdental-dentalsis-kontrol.sql dosyasını Supabase'de çalıştırın." : error.message);
    }
    await sb.from("dsis_remote_jobs").delete().gte("id", -1);
  }

  // iş listesi: sayfa sayfa (yeniden eskiye), 2026 öncesine inince durur
  let page = st.next;
  let stop = false;
  while (!stop && Date.now() - t0 < SCAN_DEADLINE) {
    const batch = Array.from({ length: 6 }, (_, i) => page + i);
    const res = await pool(batch, 6, async (n) => {
      for (let t = 0; t < 3; t++) {
        try { return arr(await call("/iskayits", { sayfa: String(n), search: "", filterType: "", searchType: "" })); } catch (e) { if (e instanceof TokenError || t === 2) throw e; }
      }
      return [] as Row[];
    });
    const rows: Json[] = [];
    for (let k = 0; k < res.length; k++) {
      const list = res[k] ?? [];
      if (!list.length) { stop = true; break; }
      for (const r of list) {
        if (!r || !r.id) continue;
        rows.push({ id: Number(r.id), no: Number(r.iskayitno) || null, cariid: Number(r.cariid) || null, cariad: str(r.cariad), hasta: str(r.hasta), provaturu: str(r.provaturu), teslim: str(r.teslim), tarih1: str(r.tarih1), tarih2: str(r.tarih2), durum: str(r.durum), seen_at: new Date().toISOString() });
      }
      const maxT1 = list.map((r) => String(r.tarih1 ?? "")).sort().pop() ?? "";
      st.oldest = list.map((r) => String(r.tarih1 ?? "")).sort()[0] ?? st.oldest;
      if (maxT1 && maxT1 < START) { stop = true; break; }
    }
    for (let i = 0; i < rows.length; i += 500) await sb.from("dsis_remote_jobs").upsert(rows.slice(i, i + 500));
    st.rows = (st.rows ?? 0) + rows.length;
    st.pages = (st.pages ?? 0) + batch.length;
    page += batch.length;
  }
  st.next = page;
  if (stop) { st.done = true; st.finished = new Date().toISOString(); }
  await setState(sb, "audit_scan", st);
  return { ok: true, state: st, message: st.done ? `Tarama bitti: ${st.rows} iş, ${st.pages} sayfa.` : `Tarama sürüyor: ${st.rows} iş okundu (sayfa ${st.next}); “Devam et”e basın.` };
}

/** Eksik / farklı işleri aktar, bakiyeleri eşitle */
export async function dsisAuditFix(sb: SupabaseClient): Promise<{ ok: boolean; message: string; steps: Json }> {
  // otomatik eşitleme turu sürerken aynı kayıtlara iki taraftan yazılmasın (kilit beklemesi zaman aşımına yol açar)
  const lock = await getState<{ at: string }>(sb, "lock");
  if (lock && Date.now() - Date.parse(lock.at) < 4 * 60_000) return { ok: false, steps: {}, message: "Otomatik eşitleme şu an çalışıyor; 1-2 dakika sonra yeniden “Düzelt”e basın." };
  await setState(sb, "lock", { at: new Date().toISOString(), by: "audit" });
  try { return await fixInner(sb); } finally { await sb.from("dsis_sync_state").delete().eq("key", "lock"); }
}

async function fixInner(sb: SupabaseClient): Promise<{ ok: boolean; message: string; steps: Json }> {
  const call = client(sb, (await getState<{ t: string }>(sb, "token"))?.t ?? null);
  const steps: Json = {};
  // yeni hekimler önce açılır
  const cari = arr(await call("/cari"));
  steps.ref = await rpc(sb, "dsis_import_ref", { p_cari: cari, p_stok: arr(await call("/stok")) });
  steps.customers = await rpc(sb, "dsis_update_customers", { p_cari: cari });

  // listelerde en çok 100 kayıt döner; eksiklerin tamamı için doğrudan sorgu
  const remote = await allRows<{ id: number }>((a, b) => sb.from("dsis_remote_jobs").select("id").or("durum.is.null,durum.eq.1").order("id", { ascending: false }).range(a, b));
  const remoteIds = remote.data.map((r) => Number(r.id));
  const inErp = new Set<number>();
  for (let i = 0; i < remoteIds.length; i += 1000) {
    const { data } = await sb.from("jobs").select("legacy_id").in("legacy_id", remoteIds.slice(i, i + 1000));
    for (const j of data ?? []) inErp.add(Number(j.legacy_id));
  }
  const want = new Set<number>();
  for (const id of remoteIds) if (!inErp.has(id) && want.size < FIX_BUDGET) want.add(id);
  // durum farkları: listeler en çok 100 kayıt döner; tamamı için doğrudan sorgu
  const { data: rjAll } = await sb.from("dsis_remote_jobs").select("id, provaturu, teslim").or("durum.is.null,durum.eq.1").limit(60000);
  const rjMap = new Map((rjAll ?? []).map((r) => [Number(r.id), r]));
  const erpJobs = await allRows<{ legacy_id: number; status: string; in_date: string }>((a, b) => sb.from("jobs").select("legacy_id, status, in_date").gt("legacy_id", 0).neq("status", "cancelled").order("legacy_id").range(a, b));
  const closedInDsis = (r: { provaturu: string | null; teslim: string | null }) => r.provaturu === "BİTİM" && (r.teslim ?? "1") === "1";
  const shouldClose: number[] = [], shouldOpen: number[] = [], erpOnly: number[] = [];
  const { data: r0 } = await sb.from("dsis_remote_jobs").select("tarih1").not("tarih1", "is", null).order("tarih1").limit(1).maybeSingle();
  const fromDate = String(r0?.tarih1 ?? "2026-01-01").slice(0, 10);
  for (const j of erpJobs.data) {
    const r = rjMap.get(Number(j.legacy_id));
    if (!r) { if (String(j.in_date) >= fromDate) erpOnly.push(Number(j.legacy_id)); continue; }
    if (closedInDsis(r) && ["open", "tryin", "ready"].includes(j.status)) shouldClose.push(Number(j.legacy_id));
    else if (!closedInDsis(r) && j.status === "delivered") shouldOpen.push(Number(j.legacy_id));
  }
  for (const id of [...shouldClose, ...shouldOpen, ...erpOnly]) if (want.size < FIX_BUDGET) want.add(id);
  const missingTotal = remoteIds.filter((id) => !inErp.has(id)).length;
  const todo = missingTotal + shouldClose.length + shouldOpen.length + erpOnly.length;

  // ERP'de olup Dentalsis listesinde olmayan iş: ayrıntısı da yoksa Dentalsis'te silinmiş demektir → ERP'de iptal edilir
  const erpOnlySet = new Set(erpOnly);
  const details = (await pool([...want], 8, async (id) => {
    try {
      const j = await call("/iskayit", { id: String(id) });
      const d = j.data as Json | undefined;
      if (d && typeof d === "object" && d.id) return slimJob(d);
      if (erpOnlySet.has(id) && j.success !== false && (d === null || d === undefined || (typeof d === "object" && !Object.keys(d).length) || (Array.isArray(d) && !d.length))) return { id, durum: 0, stoklar: [], provalar: [], teeth: {}, flags: {} } as Json;
      return null;
    } catch (e) { if (e instanceof TokenError) throw e; return null; }
  })).filter((x): x is Json => !!x);
  const jobSum: Record<string, number> = {};
  for (let i = 0; i < details.length; i += 40) {
    const part = details.slice(i, i + 40);
    sum(jobSum, await rpc(sb, "dsis_import_jobs", { p_jobs: part }));
    sum(jobSum, await rpc(sb, "dsis_sync_jobs", { p_jobs: part }));
  }
  steps.jobs = jobSum;
  steps.fetched = details.length;
  const now = new Date().toISOString();
  const seen = details.map((d) => ({ legacy_id: Number(d.id), detail_at: now, seen_at: now }));
  for (let i = 0; i < seen.length; i += 500) await sb.from("dsis_job_seen").upsert(seen.slice(i, i + 500));

  // bakiyeler: tüm cariler (tahsilatlar son 60 gün)
  const from = new Date(Date.now() - 60 * 86_400_000);
  const [tah, bal] = await Promise.all([
    call("/rapor-tahsilat", { f: JSON.stringify({ tarih1: from.toISOString(), tarih2: new Date().toISOString(), cariler: [], hekimgrup: false, sehirler: "" }), sube: "" }).then(arr),
    call("/cari-ekstre-toplam").then(arr),
  ]);
  steps.balance = await balanceChunks(sb, tah, bal);
  // karşılaştırma için güncel bakiyeler
  const balRows = bal.filter((b) => b && b.id).map((b) => ({ id: Number(b.id), tl: Number(b.tltutar ?? 0), eur: Number(b.eurotutar ?? 0), usd: Number(b.usdtutar ?? 0), seen_at: now }));
  for (let i = 0; i < balRows.length; i += 500) await sb.from("dsis_remote_cari").upsert(balRows.slice(i, i + 500));

  const left = Math.max(0, todo - details.length);
  const j = jobSum;
  return { ok: true, steps, message: `${j.inserted ?? 0} iş aktarıldı, ${(j.status_updated ?? 0) + (j.reopened ?? 0)} işin durumu eşitlendi, ${j.cancelled ?? 0} iş Dentalsis'te silindiği için iptal edildi, ${(j.items_updated ?? 0) + (j.info_updated ?? 0)} iş güncellendi, ${Number((steps.balance as Json).adjusted ?? 0)} bakiye düzeltildi.${left ? ` ${left} iş daha sırada: yeniden “Düzelt”e basın.` : ""}` };
}
