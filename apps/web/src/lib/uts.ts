import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ÜTS web servis istemcisi (zamanlanmış görev).
 *
 * Token Vercel'de UTS_TOKEN ortam değişkenindedir; kodda, veritabanında ve kayıtlarda tutulmaz.
 * Ortam: ERP'deki ÜTS ayarından (test / canlı). Adresler gerekirse UTS_BASE_URL_TEST / UTS_BASE_URL_LIVE ile değiştirilebilir.
 *
 * ÖNEMLİ: Servis yolları ve alan adları ÜTS "Takip ve İzleme Web Servis Tanımları" dokümanına göre
 * tek yerde (UTS_SERVICES) tanımlıdır. Canlıya geçmeden önce dokümanla ve ÜTS test ortamında doğrulanmalıdır.
 * Ismarlama ürün bildirimi bu dokümanda yer almadığı için ÜTS ekranından elle yapılır; ERP gerekli bilgileri hazırlar.
 */

export type UtsKind = "alma" | "kullanim" | "verme" | "ismarlama";
type Row = {
  id: string; kind: UtsKind; product_no: string | null; lot_no: string | null; serial_no: string | null; qty: number | null; expiry_date: string | null;
  counterparty_no: string | null; event_date: string; own_no: string | null; env_setting: "test" | "live"; payload: Record<string, unknown>;
  vbi: string | null; bno: string | null;
};

const BASE = {
  test: process.env.UTS_BASE_URL_TEST || "https://utstest.saglik.gov.tr/UTS/",
  live: process.env.UTS_BASE_URL_LIVE || "https://utsuygulama.saglik.gov.tr/UTS/",
};

/** Ürün kimliği: lot takipli ürünlerde LNO + ADT, seri (tekil) takipte SNO */
const ident = (r: Row) => ({ UNO: r.product_no ?? undefined, ...(r.serial_no ? { SNO: r.serial_no } : { LNO: r.lot_no ?? undefined, ADT: Number(r.qty ?? 1) }) });

/** Belge no (verme bildiriminde zorunlu): elle girilen, yoksa iş / mal kabul belgesi */
const docNo = (r: Row) => r.bno || (r.payload.invoice_no as string | undefined) || (r.payload.job_no ? `IS-${r.payload.job_no}` : undefined) || (r.payload.doc as string | undefined);
/** Barkod kuruluşu (BRK): eski doküman sürümlerinde zorunlu; UTS_SEND_BRK=1 ise gönderilir (GTIN → GS1) */
const brk = (r: Row) => (process.env.UTS_SEND_BRK === "1" ? { BRK: /^[0-9]{8,14}$/.test(r.product_no ?? "") ? "GS1" : "UTS" } : {});

/**
 * Servisler (Takip ve İzleme Web Servis Tanımları):
 *  verme   …/bildirim/verme/ekle    UNO, LNO+ADT | SNO, KUN (alan kurum), BNO (belge no, zorunlu), BEN (bedelsiz numune, isteğe bağlı)
 *  alma    …/bildirim/alma/ekle     VBI (tedarikçinin verme bildirim ID'si, zorunlu), ADT (eksik alındıysa)
 *  kullanim …/bildirim/kullanim/ekle UNO, LNO+ADT | SNO, GIT (gerçek işlem tarihi); hasta bilgisi yalnız kimlik isteyen ürünlerde
 */
export const UTS_SERVICES: Record<Exclude<UtsKind, "ismarlama">, { path: string; body: (r: Row) => Record<string, unknown>; needs: Array<keyof Row | "doc"> }> = {
  alma: { path: "uh/rest/bildirim/alma/ekle", needs: ["vbi"], body: (r) => ({ VBI: r.vbi, ...(r.qty && !r.serial_no ? { ADT: Number(r.qty) } : {}) }) },
  kullanim: { path: "uh/rest/bildirim/kullanim/ekle", needs: ["product_no"], body: (r) => ({ ...brk(r), ...ident(r), GIT: r.event_date }) },
  verme: { path: "uh/rest/bildirim/verme/ekle", needs: ["product_no", "counterparty_no", "doc"], body: (r) => ({ ...brk(r), ...ident(r), KUN: r.counterparty_no, BNO: docNo(r)?.slice(0, 50) }) },
};

const LABEL: Record<string, string> = { product_no: "ürün numarası (UNO)", counterparty_no: "karşı kurumun ÜTS kurum no", lot_no: "lot", serial_no: "seri no", vbi: "tedarikçinin verme bildirim ID'si (VBI: ÜTS'de \"alma bekleyenler\" listesinde)", doc: "belge no (fatura / irsaliye)" };

/** Cevaptaki hata mesajları ve bildirim numarası (ÜTS cevabı: SNC / MSJ listeleri) */
function readResponse(j: unknown): { ok: boolean; ref: string | null; text: string } {
  const msgs: string[] = [];
  let ref: string | null = null;
  let err = false;
  const walk = (v: unknown, depth = 0) => {
    if (!v || depth > 6) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    if (typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const tip = String(o.TIP ?? o.tip ?? o.type ?? "").toUpperCase();
    const mesaj = o.MET ?? o.MSJ ?? o.mesaj ?? o.message;
    if (typeof mesaj === "string") msgs.push(mesaj);
    if (/HATA|ERROR|FAIL/.test(tip)) err = true;
    for (const k of ["BID", "bildirimId", "BILDIRIMID", "ID"]) if (!ref && (typeof o[k] === "string" || typeof o[k] === "number")) ref = String(o[k]);
    Object.values(o).forEach((x) => walk(x, depth + 1));
  };
  walk(j);
  return { ok: !err, ref, text: msgs.join(" · ").slice(0, 1500) };
}

export function utsConfigured() { return !!process.env.UTS_TOKEN; }

/** Bekleyen bildirimleri ÜTS'ye gönderir */
export async function sendUtsQueue(): Promise<{ sent: number; failed: number; skipped: string | null }> {
  const token = process.env.UTS_TOKEN;
  if (!token) return { sent: 0, failed: 0, skipped: "UTS_TOKEN tanımlı değil" };
  const admin = createAdminClient();
  await admin.rpc("uts_unstick");
  const { data, error } = await admin.rpc("uts_due", { p_limit: 30 });
  if (error) return { sent: 0, failed: 0, skipped: error.message };
  let sent = 0, failed = 0;
  for (const r of (data ?? []) as Row[]) {
    const svc = UTS_SERVICES[r.kind as Exclude<UtsKind, "ismarlama">];
    const env = r.env_setting === "live" ? "live" : "test";
    const missing = svc ? svc.needs.filter((k) => (k === "doc" ? !docNo(r) : !r[k])) : [];
    if (!svc || missing.length) {
      failed++;
      await admin.rpc("uts_result", { p_id: r.id, p_ok: false, p_ref: null, p_response: null, p_error: svc ? `Eksik bilgi: ${missing.map((k) => LABEL[k] ?? k).join(", ")}` : "Bu bildirim türü ÜTS ekranından elle yapılır.", p_env: env });
      continue;
    }
    try {
      const res = await fetch(BASE[env] + svc.path, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", Accept: "application/json", utsToken: token },
        body: JSON.stringify(svc.body(r)),
        signal: AbortSignal.timeout(20000),
      });
      const raw = await res.text();
      let j: unknown = null;
      try { j = JSON.parse(raw); } catch { j = { raw: raw.slice(0, 2000) }; }
      const out = readResponse(j);
      const ok = res.ok && out.ok;
      if (ok) sent++; else failed++;
      await admin.rpc("uts_result", { p_id: r.id, p_ok: ok, p_ref: out.ref, p_response: j, p_error: ok ? null : `HTTP ${res.status}${out.text ? ` · ${out.text}` : ""}`, p_env: env });
    } catch (e) {
      failed++;
      await admin.rpc("uts_result", { p_id: r.id, p_ok: false, p_ref: null, p_response: null, p_error: `Bağlantı: ${(e as Error).message}`.slice(0, 500), p_env: env });
    }
  }
  return { sent, failed, skipped: null };
}
