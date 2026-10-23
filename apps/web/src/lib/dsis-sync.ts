import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Dentalsis Plus → ERP otomatik eşitleme (Vercel Cron, 5 dakikada bir).
 * Dentalsis API'si (api.dentalofisi.com) form gövdeli POST istekleri ve "apitoken" ile çalışır.
 * Oturum: DENTALSIS_EMAIL + DENTALSIS_PASSWORD (Vercel ortam değişkeni; kullanıcı kendisi girer).
 * Alınan anahtar dsis_sync_state.token satırında saklanır; geçersizleşince yeniden giriş yapılır.
 * Dentalsis geçerlidir: değişen işler, hekim bilgileri, provalar ve tahsilat / bakiye ERP'ye işlenir.
 */
const API = "https://api.dentalofisi.com";
const env = (k: string) => (process.env[k] ?? "").trim().replace(/^["'`]+|["'`]+$/g, "");
export const dsisSyncReady = () => !!(env("DENTALSIS_EMAIL") && env("DENTALSIS_PASSWORD"));

export type Json = Record<string, unknown>;
export type Row = Json & { id: number };
export type DsisSyncResult = { ok: boolean; at: string; ms: number; message: string; steps: Record<string, unknown>; error?: string };

const DETAIL_BUDGET = 220; // bir çalışmada en çok bu kadar iş ayrıntısı çekilir
const CONCURRENCY = 8;

export class TokenError extends Error {}

async function post(path: string, body: Record<string, string>, timeoutMs = 45_000): Promise<Json> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString(), signal: ctl.signal, cache: "no-store" });
    const text = await r.text();
    if (r.status === 401 || r.status === 403) throw new TokenError(`Dentalsis oturumu reddedildi (${r.status})`);
    if (!r.ok) throw new Error(`Dentalsis ${path}: HTTP ${r.status}`);
    let j: Json;
    try { j = JSON.parse(text) as Json; } catch { throw new Error(`Dentalsis ${path}: beklenmeyen yanıt`); }
    if (j.success === false && /token|oturum|yetki|login|giri/i.test(String(j.message ?? ""))) throw new TokenError(String(j.message));
    return j;
  } finally {
    clearTimeout(t);
  }
}

export async function getState<T>(sb: SupabaseClient, key: string): Promise<T | null> {
  const { data } = await sb.from("dsis_sync_state").select("val").eq("key", key).maybeSingle();
  return (data?.val as T) ?? null;
}
export async function setState(sb: SupabaseClient, key: string, val: unknown) {
  await sb.from("dsis_sync_state").upsert({ key, val, updated_at: new Date().toISOString() });
}

async function login(sb: SupabaseClient): Promise<string> {
  const j = await post("/login", { email: env("DENTALSIS_EMAIL"), password: env("DENTALSIS_PASSWORD") });
  const tok = (j.data as Json | undefined)?.apiToken;
  if (typeof tok !== "string" || !tok) throw new Error("Dentalsis'e giriş yapılamadı: kullanıcı adı / şifre hatalı olabilir");
  await setState(sb, "token", { t: tok, at: new Date().toISOString() });
  return tok;
}

/** Anahtarla çağır; anahtar geçersizse bir kez yeniden giriş yapıp tekrar dene */
export function client(sb: SupabaseClient, initial: string | null) {
  let tok = initial;
  return async (path: string, extra: Record<string, string> = {}): Promise<Json> => {
    if (!tok) tok = await login(sb);
    try {
      return await post(path, { apitoken: tok, ...extra });
    } catch (e) {
      if (!(e instanceof TokenError)) throw e;
      tok = await login(sb);
      return post(path, { apitoken: tok, ...extra });
    }
  };
}

export const arr = (j: Json): Row[] => {
  const d = j.data as unknown;
  if (Array.isArray(d)) return d as Row[];
  if (d && typeof d === "object") {
    const o = d as Json;
    if (Array.isArray(o.list)) return o.list as Row[];
    const a = Object.values(o).find(Array.isArray);
    if (a) return a as Row[];
  }
  return [];
};

/** Dentalsis iş ayrıntısı → aktarım fonksiyonlarının beklediği sade kayıt */
export function slimJob(d: Json): Json {
  const teeth: Record<string, number> = {};
  const out: Json = {};
  for (const [k, v] of Object.entries(d)) {
    const m = /^dis(\d\d)$/.exec(k);
    if (m) { if (Number(v)) teeth[m[1]] = Number(v); continue; }
    if (/^dis\d\d_\d$/.test(k) || k.startsWith("paylas") || k === "cari") continue;
    if (v === null || typeof v !== "object") out[k] = v;
  }
  const scalar = (o: Json) => Object.fromEntries(Object.entries(o).filter(([, v]) => v === null || typeof v !== "object"));
  out.teeth = teeth;
  out.flags = Object.fromEntries(["isirik", "model", "olcu", "kasik", "mum", "metalbant_cepecevre", "metalbant_var", "metalbant_yok"].map((f) => [f, Number(d[f] ?? 0)]));
  out.stoklar = Array.isArray(d.stoklar) ? (d.stoklar as Json[]).map(scalar) : [];
  out.provalar = Array.isArray(d.provalar) ? (d.provalar as Json[]).map(scalar) : [];
  return out;
}

const fp = (r: Row) => [r.iskayitno, r.fisno, r.cariad, r.doktor, r.hasta, r.disrenk, r.disrenk1, r.disrenk2, r.provaturu, r.tarih1, r.tarih2].map((x) => String(x ?? "")).join("|");

export async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

export async function rpc(sb: SupabaseClient, fn: string, args: Json): Promise<Json> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return (data ?? {}) as Json;
}

export const sum = (into: Record<string, number>, r: Json) => { for (const [k, v] of Object.entries(r)) if (typeof v === "number") into[k] = (into[k] ?? 0) + v; };

/** Bakiye eşitleme parça parça (zaman aşımına düşmesin): ilk parçada tahsilatlar da işlenir */
export async function balanceChunks(sb: SupabaseClient, tah: Row[], bal: Row[]): Promise<Json> {
  const out: Record<string, number> = {};
  const names: string[] = [];
  for (let i = 0; i < bal.length; i += 60) {
    const r = await rpc(sb, "dsis_import_balance", { p_tahsilat: tah, p_balances: bal.slice(i, i + 60), p_pay: i === 0 });
    for (const [k, v] of Object.entries(r)) if (typeof v === "number") out[k] = (out[k] ?? 0) + (k === "unmatched_payments" && i > 0 ? 0 : v);
    if (i === 0 && Array.isArray(r.unmatched_names)) names.push(...(r.unmatched_names as string[]));
  }
  return { ...out, unmatched_names: names };
}

/** Bir eşitleme turu. sb: service role istemcisi */
export async function runDsisSync(sb: SupabaseClient, opts: { force?: boolean } = {}): Promise<DsisSyncResult> {
  const t0 = Date.now();
  const at = new Date().toISOString();
  const steps: Record<string, unknown> = {};
  const finish = async (ok: boolean, message: string, error?: string): Promise<DsisSyncResult> => {
    const res: DsisSyncResult = { ok, at, ms: Date.now() - t0, message, steps, error };
    await setState(sb, "last", res);
    if (ok) await setState(sb, "last_ok", res);
    return res;
  };
  if (!dsisSyncReady()) return { ok: false, at, ms: 0, message: "Dentalsis kullanıcı bilgileri Vercel'e girilmemiş (DENTALSIS_EMAIL, DENTALSIS_PASSWORD)", steps };
  const cfg = (await getState<{ enabled?: boolean }>(sb, "config")) ?? {};
  if (cfg.enabled === false && !opts.force) return { ok: true, at, ms: 0, message: "Otomatik eşitleme kapalı", steps };

  // aynı anda iki tur çalışmasın (önceki tur 4 dakikadan yeniyse bekle)
  const lock = await getState<{ at: string }>(sb, "lock");
  if (lock && Date.now() - Date.parse(lock.at) < 4 * 60_000 && !opts.force) return { ok: true, at, ms: 0, message: "Önceki tur sürüyor", steps };
  await setState(sb, "lock", { at });

  try {
    const call = client(sb, (await getState<{ t: string }>(sb, "token"))?.t ?? null);

    // 1) Hekimler ve ürünler (yeni olanlar açılır, mevcut hekimlerin bilgileri güncellenir)
    const [cari, stok] = await Promise.all([call("/cari").then(arr), call("/stok").then(arr)]);
    steps.ref = await rpc(sb, "dsis_import_ref", { p_cari: cari, p_stok: stok });
    steps.customers = await rpc(sb, "dsis_update_customers", { p_cari: cari });

    // 2) İş listesi (teslim tarihine göre son 5000 iş, hafif alanlar) → değişenler
    const list = arr(await call("/iskayits-cache")).filter((r) => r && r.id);
    const ids = list.map((r) => Number(r.id));
    const known = new Map<number, string>();
    const inErp = new Set<number>();
    const erpStatus = new Map<number, string>();
    for (let i = 0; i < ids.length; i += 1000) {
      const part = ids.slice(i, i + 1000);
      const [{ data: seen }, { data: jobs }] = await Promise.all([
        sb.from("dsis_job_seen").select("legacy_id, fp").in("legacy_id", part),
        sb.from("jobs").select("legacy_id, status").in("legacy_id", part),
      ]);
      for (const s of seen ?? []) known.set(Number(s.legacy_id), String(s.fp ?? ""));
      for (const j of jobs ?? []) { inErp.add(Number(j.legacy_id)); erpStatus.set(Number(j.legacy_id), String(j.status)); }
    }
    // ERP'de olmayan işler: 2026 kayıtları ve tarihi ne olursa olsun Dentalsis'te hâlâ açık olanlar
    const isNew = list.filter((r) => !inErp.has(Number(r.id)) && (String(r.tarih1 ?? "") >= "2026-01-01" || String(r.provaturu ?? "") !== "BİTİM"));
    // ilk kez görülen (daha önce aktarılmış) işler için parmak izi temel alınır; ayrıntı çekilmez
    const baseline = list.filter((r) => inErp.has(Number(r.id)) && !known.has(Number(r.id)));
    if (baseline.length) {
      const now0 = new Date().toISOString();
      const rows = baseline.map((r) => ({ legacy_id: Number(r.id), fp: fp(r), seen_at: now0 }));
      for (let i = 0; i < rows.length; i += 500) await sb.from("dsis_job_seen").upsert(rows.slice(i, i + 500), { onConflict: "legacy_id", ignoreDuplicates: true });
      for (const r of baseline) known.set(Number(r.id), fp(r));
    }
    const changed = list.filter((r) => inErp.has(Number(r.id)) && known.get(Number(r.id)) !== fp(r));
    // Dentalsis'te açık (son prova BİTİM değil) ama ERP'de teslim / iptal görünen işler: önce bunlar düzeltilir
    const closedInErp = (r: Row) => ["delivered", "cancelled"].includes(erpStatus.get(Number(r.id)) ?? "");
    const reopen = list.filter((r) => closedInErp(r) && String(r.provaturu ?? "") !== "BİTİM");
    // BİTİM ama henüz teslim edilmemiş olabilir (teslim tarihi yakın olanlar)
    const soon = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const maybeAll = list.filter((r) => closedInErp(r) && String(r.provaturu ?? "") === "BİTİM" && String(r.tarih2 ?? "") >= soon);
    const checked = new Map<number, number>();
    for (let i = 0; i < maybeAll.length; i += 1000) {
      const { data } = await sb.from("dsis_job_seen").select("legacy_id, detail_at").in("legacy_id", maybeAll.slice(i, i + 1000).map((r) => Number(r.id)));
      for (const x of data ?? []) checked.set(Number(x.legacy_id), x.detail_at ? Date.parse(String(x.detail_at)) : 0);
    }
    const maybe = maybeAll.filter((r) => Date.now() - (checked.get(Number(r.id)) ?? 0) > 6 * 3600_000);
    const want = new Map<number, Row>();
    for (const r of [...isNew, ...reopen, ...changed, ...maybe]) if (want.size < DETAIL_BUDGET) want.set(Number(r.id), r);
    // kalan bütçe: ERP'de açık / provadaki işler, en uzun süredir bakılmayan önce (teslim, kalem, silme değişiklikleri için)
    if (want.size < DETAIL_BUDGET) {
      const { data: open } = await sb.from("jobs").select("legacy_id").in("status", ["open", "tryin", "ready"]).gt("legacy_id", 0).limit(2000);
      const openIds = (open ?? []).map((o) => Number(o.legacy_id)).filter((x) => !want.has(x));
      const lastAt = new Map<number, number>();
      for (let i = 0; i < openIds.length; i += 1000) {
        const { data } = await sb.from("dsis_job_seen").select("legacy_id, detail_at").in("legacy_id", openIds.slice(i, i + 1000));
        for (const s of data ?? []) lastAt.set(Number(s.legacy_id), s.detail_at ? Date.parse(String(s.detail_at)) : 0);
      }
      openIds.sort((a, b) => (lastAt.get(a) ?? 0) - (lastAt.get(b) ?? 0));
      for (const id of openIds) { if (want.size >= DETAIL_BUDGET) break; want.set(id, { id } as Row); }
    }
    const t1s = list.map((r) => String(r.tarih1 ?? "")).sort();
    const t2s = list.map((r) => String(r.tarih2 ?? "")).sort();
    steps.list = { total: list.length, new: isNew.length, reopen: reopen.length, maybe: maybe.length, changed: changed.length, baseline: baseline.length, fetched: want.size, in_erp: inErp.size, max_id: Math.max(0, ...ids), tarih1_max: t1s[t1s.length - 1] ?? null, tarih2_min: t2s[0] ?? null, tarih2_max: t2s[t2s.length - 1] ?? null };

    const byId = new Map(list.map((r) => [Number(r.id), r]));
    const details = (await pool([...want.keys()], CONCURRENCY, async (id) => {
      try {
        const j = await call("/iskayit", { id: String(id) });
        const d = j.data as Json | undefined;
        return d && typeof d === "object" && d.id ? slimJob(d) : null;
      } catch (e) {
        if (e instanceof TokenError) throw e;
        return null;
      }
    })).filter((x): x is Json => !!x);
    steps.details_ok = details.length;

    const jobSum: Record<string, number> = {};
    for (let i = 0; i < details.length; i += 40) {
      const part = details.slice(i, i + 40);
      sum(jobSum, await rpc(sb, "dsis_import_jobs", { p_jobs: part }));
      sum(jobSum, await rpc(sb, "dsis_sync_jobs", { p_jobs: part }));
    }
    steps.jobs = jobSum;
    const now = new Date().toISOString();
    const seenRows = details.map((d) => { const id = Number(d.id); const r = byId.get(id); return { legacy_id: id, fp: r ? fp(r) : null, detail_at: now, seen_at: now }; });
    for (let i = 0; i < seenRows.length; i += 500) await sb.from("dsis_job_seen").upsert(seenRows.slice(i, i + 500));

    // 3) Tahsilatlar (son 45 gün) ve hekim bakiyeleri (Dentalsis'teki bakiyeye eşitlenir)
    const from = new Date(Date.now() - 45 * 86_400_000);
    from.setHours(0, 0, 0, 0);
    const [tah, bal] = await Promise.all([
      call("/rapor-tahsilat", { f: JSON.stringify({ tarih1: from.toISOString(), tarih2: new Date().toISOString(), cariler: [], hekimgrup: false, sehirler: "" }), sube: "" }).then(arr),
      call("/cari-ekstre-toplam").then(arr),
    ]);
    steps.balance = bal.length ? await balanceChunks(sb, tah, bal) : { skipped: "bakiye listesi boş" };
    steps.payments_seen = tah.length;
    steps.balances_seen = bal.length;
    steps.samples = { tahsilat: tah[0] ? Object.keys(tah[0]).slice(0, 25) : null, bakiye: bal[0] ? Object.keys(bal[0]).slice(0, 25) : null, is: list[0] ? Object.keys(list[0]).slice(0, 25) : null };

    const j = steps.jobs as Record<string, number>;
    const msg = `${j.inserted ?? 0} yeni iş, ${(j.items_updated ?? 0) + (j.info_updated ?? 0) + (j.steps_updated ?? 0) + (j.status_updated ?? 0)} güncelleme`;
    console.log("[dsis-sync]", JSON.stringify(steps));
    return await finish(true, msg);
  } catch (e) {
    console.error("[dsis-sync] hata", (e as Error).message, JSON.stringify(steps));
    return await finish(false, "Eşitleme yapılamadı", (e as Error).message);
  } finally {
    await sb.from("dsis_sync_state").delete().eq("key", "lock");
  }
}
