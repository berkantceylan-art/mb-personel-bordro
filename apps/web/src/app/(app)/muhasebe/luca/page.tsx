import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { KPI, Notice, btnPrimary, btnSecondary, inputCls, page, td, tdNum, th } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { DOC_TYPE, VOUCHER_SOURCE, glError } from "@/lib/gl";
import { fisNo, lucaKind, type LucaVoucher } from "@/lib/luca-gl";
import { lucaAutoMap, lucaBatchUndo, lucaExport, lucaMapSet } from "@/lib/luca-actions";
import { CheckAll } from "./_parts/CheckAll";

export const dynamic = "force-dynamic";

type Preview = {
  settings: { template_name: string | null; plan_count: number; exclude_prefixes: string[]; columns: Array<{ header: string }> };
  vouchers: LucaVoucher[];
  missing_accounts: Array<{ erp_code: string; luca_code: string; name: string; count: number; reason: "missing" | "not_leaf"; suggest: string | null; options: Array<{ code: string; name: string | null }> }>;
  drafts: number;
  pending: number;
};
type Batch = { id: string; no: number; from_date: string | null; to_date: string | null; vouchers: number; lines: number; total: number; note: string | null; created_at: string; undone_at: string | null };

const MODES: Array<[string, string]> = [["new", "Aktarılmamış"], ["changed", "Aktarıldıktan sonra değişen"], ["exported", "Aktarılanlar"], ["all", "Tümü"]];

/** Luca aktarımı: onaylı fişleri Luca Excel Veri Aktarımı dosyasına çevirir, aktarılanları işaretler */
export default async function LucaExport({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string; mod?: string; paket?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const approver = (s.modules.ledger ?? 0) >= 3;
  const sp = await searchParams;
  const now = new Date(Date.now() + 3 * 3600000);
  const pf = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const pt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const from = sp.bas && /^\d{4}-\d{2}-\d{2}$/.test(sp.bas) ? sp.bas : pf;
  const to = sp.bit && /^\d{4}-\d{2}-\d{2}$/.test(sp.bit) ? sp.bit : pt;
  const mode = MODES.some(([k]) => k === sp.mod) ? sp.mod! : "new";
  const supabase = await createClient();
  const [{ data, error }, { data: bdata }] = await Promise.all([
    supabase.rpc("gl_luca_preview", { p_from: from, p_to: to, p_mode: mode }),
    supabase.from("gl_luca_batches").select("id,no,from_date,to_date,vouchers,lines,total,note,created_at,undone_at").order("no", { ascending: false }).limit(20),
  ]);
  const p = data as Preview | null;
  const batches = (bdata ?? []) as Batch[];
  const vs = p?.vouchers ?? [];
  const blocked = vs.filter((v) => v.blocked);
  const excluded = vs.filter((v) => !v.blocked && v.excluded_by);
  const ready = vs.filter((v) => !v.blocked && !v.excluded_by);
  const q = (o: Record<string, string>) => `/muhasebe/luca?${new URLSearchParams({ bas: from, bit: to, mod: mode, ...o })}`;

  return (
    <>
      <PageHeader title="Luca aktarımı" subtitle="Onaylı fişler Luca'nın Excel Veri Aktarımı dosyasına çevrilir; aktarılan fiş işaretlenir, ikinci kez gitmez" actions={<span className="flex flex-wrap gap-4"><Link href="/muhasebe/luca/hesap-plani" className="text-sm font-semibold text-brand-700">Hesap planı ve kategoriler</Link><Link href="/muhasebe/luca/ayarlar" className="text-sm font-semibold text-brand-700">Şablon ve kurallar</Link></span>} />
      <div className={page}>
        {error && <Notice tone="bad">{/function|does not exist|schema cache|relation/.test(error.message) ? "Supabase'de 20270219000000_luca_export.sql çalıştırılmalı." : glError(error.message)}</Notice>}
        {p && !p.settings.template_name && <Notice tone="warn">Luca fiş şablonu henüz yüklenmedi; varsayılan sütunlar ({p.settings.columns.map((c) => c.header).join(", ")}) kullanılıyor. <Link href="/muhasebe/luca/ayarlar" className="font-semibold text-brand-700">Luca&apos;dan &quot;Şablon indir&quot; ile aldığınız dosyayı yükleyin</Link>.</Notice>}
        {p && !p.settings.plan_count && <Notice tone="warn">Luca hesap planı yüklenmedi: hesap kodlarının Luca&apos;da olup olmadığı kontrol edilemiyor. <Link href="/muhasebe/luca/ayarlar" className="font-semibold text-brand-700">Hesap planını yükleyin</Link>.</Notice>}
        {p && p.drafts > 0 && <Notice tone="info">Bu tarihlerde onay bekleyen {p.drafts} fiş var; onaylanmadan aktarılmaz. <Link href="/muhasebe/gelen-kutusu" className="font-semibold text-brand-700">Fiş onayına git</Link>.</Notice>}
        {p && p.pending > 0 && <Notice tone="warn">{p.pending} kayıt eşleştirme bekliyor (henüz fiş olmadı).</Notice>}

        <form className="flex flex-wrap items-end gap-2">
          <label className="text-sm font-semibold flex flex-col gap-1">Başlangıç<input type="date" name="bas" defaultValue={from} className={`${inputCls} w-44`} /></label>
          <label className="text-sm font-semibold flex flex-col gap-1">Bitiş<input type="date" name="bit" defaultValue={to} className={`${inputCls} w-44`} /></label>
          <input type="hidden" name="mod" value={mode} />
          <button className={btnSecondary}>Göster</button>
        </form>
        <div className="flex flex-wrap gap-2 text-sm">
          {MODES.map(([k, l]) => <Link key={k} href={q({ mod: k })} className={`rounded-full px-3 py-1.5 font-semibold ${k === mode ? "bg-brand-700 text-white" : "bg-[#F2F4F7]"}`}>{l}</Link>)}
        </div>

        {p && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPI label="Aktarıma hazır" value={String(ready.length)} tone={ready.length ? "ok" : undefined} sub={fmt(ready.reduce((a, v) => a + Number(v.total), 0))} />
            <KPI label="Düzeltilmesi gereken" value={String(blocked.length)} tone={blocked.length ? "bad" : undefined} sub="aktarılamaz" />
            <KPI label="Luca'da da kesilenler" value={String(excluded.length)} sub="KDV / geçici / kurumlar — varsayılan hariç" />
            <KPI label="Satır" value={String(ready.reduce((a, v) => a + v.line_count, 0))} sub={`${Math.ceil(ready.length / 50) || 0} dosya (50 fiş / dosya)`} />
          </div>
        )}

        {p && p.missing_accounts.length > 0 && (
          <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-2"><h2 className="font-bold">Luca&apos;da karşılığı olmayan hesaplar</h2><span className="text-sm text-muted">· Luca kodunu yazın ya da hesabı Luca&apos;da açın</span>
              <span className="ml-auto flex flex-wrap gap-3 items-center">
                {approver && p.missing_accounts.some((m) => m.suggest) && <form action={lucaAutoMap}><PendingSubmit className={btnSecondary}>Önerilenlerin hepsini eşleştir</PendingSubmit></form>}
                <Link href="/muhasebe/luca/hesaplar" className="text-sm font-semibold text-brand-700">Luca&apos;da açılacak hesaplar (Excel)</Link>
              </span></div>
            <table className="w-full text-sm">
              <thead><tr><th className={th}>ERP kodu</th><th className={th}>Hesap</th><th className={th}>Sorun</th><th className={th}>Satır</th><th className={th}>Luca kodu</th></tr></thead>
              <tbody>
                {p.missing_accounts.map((m) => (
                  <tr key={m.erp_code}>
                    <td className={`${td} num`}>{m.erp_code}{m.luca_code !== m.erp_code && <span className="text-muted"> → {m.luca_code}</span>}</td>
                    <td className={td}>{m.name}</td>
                    <td className={td}>{m.reason === "missing" ? "Luca planında yok" : "Luca'da ana hesap (alt hesap gerekir)"}</td>
                    <td className={tdNum}>{m.count}</td>
                    <td className={td}>{approver ? (
                      <form action={lucaMapSet} className="flex flex-wrap gap-2 items-center">
                        <input type="hidden" name="erp" value={m.erp_code} />
                        {m.options.length > 0
                          ? <select name="luca" defaultValue={m.suggest ?? ""} className={`${inputCls} h-9 w-80`}><option value="">— Luca alt hesabı seçin —</option>{m.options.map((o) => <option key={o.code} value={o.code}>{o.code} · {o.name}{o.code === m.suggest ? " (öneri)" : ""}</option>)}</select>
                          : <input name="luca" placeholder="ör. 770.01.001" className={`${inputCls} h-9 w-40`} />}
                        <PendingSubmit className="text-xs font-semibold text-brand-700">Kaydet</PendingSubmit>
                      </form>
                    ) : (m.suggest ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {p && (
          <form action={lucaExport} className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-bold">Fişler · {vs.length}</h2>
              {approver && vs.length > 0 && <CheckAll />}
              {approver && ready.length + excluded.length > 0 && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <input name="note" placeholder="paket notu (ör. Ekim 2026)" className={`${inputCls} h-10 w-60`} />
                  <PendingSubmit className={btnPrimary}>Seçilenleri aktarım paketine al</PendingSubmit>
                </div>
              )}
            </div>
            {!approver && <Notice tone="info">Aktarım paketini yönetici veya mali müşavir oluşturur.</Notice>}
            {!vs.length && <p className="text-sm text-muted">Bu tarihlerde {mode === "new" ? "aktarılmamış onaylı fiş" : "fiş"} yok.</p>}
            {vs.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className={th}></th><th className={th}>Fiş no</th><th className={th}>Tarih</th><th className={th}>Tip</th><th className={th}>Kaynak</th><th className={th}>Açıklama</th><th className={th}>Belge</th><th className={`${th} text-right`}>Tutar</th><th className={th}>Durum</th></tr></thead>
                  <tbody>
                    {vs.map((v) => (
                      <tr key={v.id} className={v.blocked ? "bg-[#FFF8F8]" : ""}>
                        <td className={td}><input type="checkbox" name="id" value={v.id} disabled={!approver || v.blocked} defaultChecked={!v.blocked && !v.excluded_by && (mode === "new" || v.changed)} /></td>
                        <td className={`${td} num whitespace-nowrap`}><Link href={`/muhasebe/fisler/${v.id}`} className="text-brand-700">{fisNo(v)}</Link></td>
                        <td className={`${td} whitespace-nowrap`}>{formatDate(v.date)}</td>
                        <td className={td}>{lucaKind(v.kind)}</td>
                        <td className={td}>{VOUCHER_SOURCE[v.source] ?? v.source}</td>
                        <td className={td}>
                          <details><summary className="cursor-pointer">{v.description ?? "—"} <span className="text-muted">· {v.line_count} satır</span></summary>
                            <table className="mt-2 w-full text-xs"><tbody>
                              {v.lines.map((l, i) => <tr key={i}><td className="py-1 pr-2 num">{l.luca_code}</td><td className="py-1 pr-2">{l.name}</td><td className="py-1 pr-2 text-muted">{l.description}</td><td className="py-1 pr-2 num text-right">{l.debit ? fmt(l.debit) : ""}</td><td className="py-1 num text-right">{l.credit ? fmt(l.credit) : ""}</td></tr>)}
                            </tbody></table>
                          </details>
                        </td>
                        <td className={td}>{v.doc_type ? `${DOC_TYPE[v.doc_type] ?? v.doc_type}${v.doc_no ? ` · ${v.doc_no}` : ""}` : "—"}{v.belge_turu && <div className="text-xs text-muted">Luca: {v.belge_turu}</div>}</td>
                        <td className={tdNum}>{fmt(v.total)}</td>
                        <td className={td}>
                          <div className="flex flex-col gap-1 text-xs">
                            {v.batch_no && <span className="rounded-full bg-[#E6F4EC] text-[#1A7F52] px-2 py-0.5 w-fit">Paket {v.batch_no}</span>}
                            {v.excluded_by && <span className="rounded-full bg-[#F2F4F7] px-2 py-0.5 w-fit">Luca&apos;da da kesiliyor ({v.excluded_by.replace(":", "")})</span>}
                            {v.issues.map((i) => <span key={i.key} className={i.block ? "text-bad font-semibold" : "text-[#7A4F00]"}>{i.text}</span>)}
                            {!v.issues.length && !v.excluded_by && !v.batch_no && <span className="text-[#1A7F52]">Hazır</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </form>
        )}

        <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
          <h2 className="font-bold">Aktarım paketleri</h2>
          {!batches.length && <p className="text-sm text-muted">Henüz paket yok.</p>}
          {batches.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={th}>Paket</th><th className={th}>Oluşturma</th><th className={th}>Fiş tarihleri</th><th className={`${th} text-right`}>Fiş</th><th className={`${th} text-right`}>Satır</th><th className={`${th} text-right`}>Tutar</th><th className={th}>Dosya</th><th className={th}></th></tr></thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id} className={`${b.undone_at ? "opacity-50" : ""} ${sp.paket === b.id ? "bg-[#EEF7F1]" : ""}`}>
                      <td className={td}><b>{b.no}</b>{b.note && <div className="text-xs text-muted">{b.note}</div>}</td>
                      <td className={`${td} whitespace-nowrap`}>{formatDate(b.created_at.slice(0, 10))}</td>
                      <td className={`${td} whitespace-nowrap`}>{b.from_date ? `${formatDate(b.from_date)} – ${formatDate(b.to_date!)}` : "—"}</td>
                      <td className={tdNum}>{b.vouchers}</td>
                      <td className={tdNum}>{b.lines}</td>
                      <td className={tdNum}>{fmt(b.total)}</td>
                      <td className={td}>{b.undone_at ? "Geri alındı" : <span className="flex gap-3"><a href={`/muhasebe/luca/indir?paket=${b.id}`} className="font-semibold text-brand-700">Excel (.xlsx)</a><a href={`/muhasebe/luca/indir?paket=${b.id}&bicim=xls`} className="font-semibold text-brand-700">Eski Excel (.xls)</a></span>}</td>
                      <td className={td}>{approver && !b.undone_at && <form action={lucaBatchUndo}><input type="hidden" name="batch" value={b.id} /><ConfirmSubmit label="Geri al" question="Paket geri alınsın mı? Luca'ya yüklediyseniz önce Luca'dan silin." /></form>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ol className="text-sm text-muted list-decimal pl-5 flex flex-col gap-1">
            <li>Dosyayı indirin (birden fazla dosya varsa ZIP gelir; açılış ve kapanış fişleri ayrı dosyadadır).</li>
            <li>Luca&apos;da Muhasebe › Excel Veri Aktarımı ekranında &quot;Dosya seç&quot; ile yükleyin, doğrulama kodunu girip &quot;Yükle&quot;ye basın.</li>
            <li>&quot;Fiş Kes&quot; penceresinde fiş tipini (dosya adındaki: mahsup / açılış / kapanış) ve belge türünü seçip fişleri oluşturun.</li>
            <li>&quot;Hesap kodu bulunamadı&quot; uyarısı çıkarsa hesabı Luca&apos;da açın veya buradan Luca kodunu eşleştirip paketi geri alıp yeniden oluşturun.</li>
          </ol>
        </section>
      </div>
    </>
  );
}
