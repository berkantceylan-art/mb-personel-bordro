import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Notice, btnPrimary, btnSecondary, inputCls, page, td, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { glError } from "@/lib/gl";
import { glCloseYear, glFxRevalue, glPayrollAccrual, glRenumber, glSetLock, glUndoClose, glVatClose } from "@/lib/gl-actions";

export const dynamic = "force-dynamic";

type St = { months: Array<{ month: string; vouchers: number; pending: number; vat: boolean; payroll: boolean; payroll_lines: boolean }>; closed: boolean; fx: Array<{ id: string; date: string; total: number }> };
const AY = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** Dönem işlemleri: ay ay KDV mahsubu ve bordro tahakkuku, kur değerleme, yıl sonu kapanış, kilit */
export default async function PeriodPage({ searchParams }: { searchParams: Promise<{ yil?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const year = sp.yil && /^\d{4}$/.test(sp.yil) ? Number(sp.yil) : new Date().getFullYear();
  const supabase = await createClient();
  const [{ data, error }, { data: set }] = await Promise.all([supabase.rpc("gl_period_status", { p_year: year }), supabase.from("gl_settings").select("lock_date, start_date").maybeSingle()]);
  const st = data as St | null;
  const canEdit = (s.modules.ledger ?? 0) >= 2;
  const admin = (s.modules.ledger ?? 0) >= 3;
  const lock = (set?.lock_date as string | null) ?? null;
  const thisMonth = new Date().toISOString().slice(0, 7);
  return (
    <>
      <PageHeader title="Dönem işlemleri" subtitle={`${year} · dönem kilidi: ${lock ? formatDate(lock) : "yok"}`} actions={<Link href="/muhasebe/beyanname" className="text-sm font-semibold text-brand-700">Beyanname hazırlık</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">{/function|does not exist|schema cache/.test(error.message) ? "Supabase'de 20270208000000_gl_close.sql çalıştırılmalı." : glError(error.message)}</Notice>}
        <div className="flex gap-2 text-sm">{[year - 1, year, year + 1].map((y) => <Link key={y} href={`/muhasebe/donem?yil=${y}`} className={`rounded-full px-3 py-1.5 font-semibold border ${y === year ? "bg-brand-700 text-white border-brand-700" : "bg-white border-line"}`}>{y}</Link>)}</div>
        {st && (
          <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead><tr className="text-xs text-muted"><th className={th}>Ay</th><th className={th}>Fiş</th><th className={th}>Bekleyen</th><th className={th}>KDV mahsubu</th><th className={th}>Bordro tahakkuku</th><th className={th}>Durum</th></tr></thead>
              <tbody>
                {st.months.map((m, i) => {
                  const locked = !!lock && `${m.month}-28` <= lock;
                  const future = m.month > thisMonth;
                  return (
                    <tr key={m.month} className={future ? "text-muted" : ""}>
                      <td className={td}><Link href={`/muhasebe/mizan?bas=${m.month}-01&bit=${new Date(Date.UTC(year, i + 1, 0)).toISOString().slice(0, 10)}`} className="font-semibold text-brand-700">{AY[i]}</Link></td>
                      <td className={td}>{m.vouchers || ""}</td>
                      <td className={td}>{m.pending ? <Link href="/muhasebe/fisler?durum=pending" className="font-semibold text-bad">{m.pending}</Link> : ""}</td>
                      <td className={td}>{m.vat ? <span className="text-ok font-semibold">✓ yapıldı</span> : !future && canEdit && !locked && m.vouchers > 0 ? <form action={glVatClose}><input type="hidden" name="month" value={m.month} /><PendingSubmit className="text-xs font-semibold text-brand-700">Mahsup fişi oluştur</PendingSubmit></form> : "—"}</td>
                      <td className={td}>{m.payroll ? <span className="text-ok font-semibold">✓ yapıldı</span> : m.payroll_lines && canEdit && !locked ? <form action={glPayrollAccrual}><input type="hidden" name="period" value={m.month} /><PendingSubmit className="text-xs font-semibold text-brand-700">Tahakkuk fişi oluştur</PendingSubmit></form> : m.payroll_lines ? "bekliyor" : "—"}</td>
                      <td className={`${td} text-xs`}>{locked ? "🔒 kilitli" : future ? "" : "açık"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {canEdit && (
            <Card title="Kur değerleme">
              <p className="text-sm text-muted">Döviz kasa / banka hesapları ve döviz cariler, seçilen tarihteki TCMB kuruyla değerlenir; fark 646 Kambiyo Kârları / 656 Kambiyo Zararları hesabına yazılır. Aynı tarih için tekrar çalıştırılırsa önceki değerleme fişi yenilenir.</p>
              <form action={glFxRevalue} className="flex items-end gap-2"><label className="flex flex-col gap-1 text-xs font-semibold text-muted">Değerleme tarihi<input type="date" name="date" defaultValue={`${year}-12-31`} className={`${inputCls} w-44`} /></label><PendingSubmit className={btnSecondary}>Değerle</PendingSubmit></form>
              {st && st.fx.length > 0 && <ul className="text-sm">{st.fx.map((f) => <li key={f.id}><Link href={`/muhasebe/fisler/${f.id}`} className="text-brand-700">{formatDate(f.date)}</Link> · {fmt(f.total)}</li>)}</ul>}
            </Card>
          )}
          {admin && (
            <Card title="Yevmiye numaralandırma ve kilit">
              <form action={glRenumber} className="flex items-end gap-2"><input type="hidden" name="year" value={year} /><PendingSubmit className={btnSecondary}>{year} yevmiye maddelerini numaralandır</PendingSubmit></form>
              <form action={glSetLock} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Bu tarihe kadar kilitle<input type="date" name="date" defaultValue={lock ?? ""} className={`${inputCls} w-44`} /></label>
                <PendingSubmit className={btnSecondary}>Kilidi kaydet</PendingSubmit>
                <span className="text-xs text-muted">Boş bırakıp kaydederseniz kilit kalkar. Kilitli döneme fiş eklenemez; ERP&apos;de iptal edilen kayıt için kilitten sonraki tarihe ters kayıt atılır.</span>
              </form>
            </Card>
          )}
          {admin && st && (
            <Card title={`${year} yıl sonu kapanışı`}>
              <ol className="list-decimal pl-5 text-sm text-muted">
                <li>7/A gider hesapları (770, 760, 780 …) 6xx hesaplarına yansıtılır, 7 sınıfı kapanır.</li>
                <li>Gelir tablosu hesapları 690&apos;a, 690 / 691 692&apos;ye, sonuç 590 Dönem Net Kârı ya da 591 Dönem Net Zararı&apos;na aktarılır.</li>
                <li>Bilanço hesapları kapanış fişiyle kapanır, {year + 1} açılış fişi oluşur.</li>
              </ol>
              <p className="text-xs text-muted">Önce kur değerleme, amortisman, KDV mahsubu ve bordro tahakkukunu tamamlayın; vergi karşılığını (691 / 370) elle fişle girin. Raporlar kapanış öncesi bakiyeyi gösterir.</p>
              {st.closed ? (
                <form action={glUndoClose} className="flex items-center gap-3"><span className="text-ok font-semibold text-sm">✓ {year} kapandı</span><input type="hidden" name="year" value={year} /><PendingSubmit className="text-sm font-semibold text-bad">Kapanışı geri al</PendingSubmit></form>
              ) : (
                <form action={glCloseYear}><input type="hidden" name="year" value={year} /><PendingSubmit className={btnPrimary}>{year} yılını kapat ve {year + 1} açılışını yap</PendingSubmit></form>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
