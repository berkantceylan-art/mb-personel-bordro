import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Field, Notice, btnPrimary, btnSecondary, inputCls, page, selectCls, td, tdNum, th } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { glError } from "@/lib/gl";
import { glDeferralDelete, glDeferralSave, glDeferralsRun, glDepreciationRun, glLoanAccrual, glPartnerReclass, glRediscountPost, glReflectMonth, glRevalPost, glRevalUndo, glSeverancePost } from "@/lib/gl-actions";
import { severanceCapAt } from "@/lib/mevzuat";

export const dynamic = "force-dynamic";

type V = { id: string; no: number; year: number; total: number };
type Check = {
  month: string; end: string; quarter_end: boolean; year_end: boolean; quarter: number; vouchers: Record<string, V>; fx: { id: string; no: number; year: number } | null;
  depreciation: { done: number; eligible: number }; deferrals: number; loans: number; pending: number; locked: boolean; reval: number;
};
type Def = { id: string; kind: string; description: string; total: number; start_month: string; months: number; pl_code: string };
type Rev = { id: string; name: string; tag: string | null; purchase_date: string; cost: number; accum: number; cost_inc: number; accum_inc: number; fund: number; done: boolean };
type Acc = { loan: string; no: number; due_date: string; currency: string; interest: number; accrued: number };

const m = (v: number) => fmt(v);

function Step({ n, title, desc, state, children }: { n: number; title: string; desc: string; state: "ok" | "todo" | "na"; children?: React.ReactNode }) {
  const chip = state === "ok" ? ["Tamam", "bg-[#E6F4EC] text-[#1A7F52]"] : state === "todo" ? ["Yapılacak", "bg-[#FFF4E0] text-[#7A4F00]"] : ["Gerekmiyor", "bg-[#F2F4F7] text-muted"];
  return (
    <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <span className="h-8 w-8 shrink-0 rounded-full bg-brand-800 text-white grid place-items-center text-sm font-bold">{n}</span>
        <div className="flex-1 min-w-60"><h2 className="font-display font-semibold text-brand-800">{title}</h2><p className="text-sm text-muted">{desc}</p></div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${chip[1]}`}>{chip[0]}</span>
      </div>
      {children}
    </section>
  );
}

const VLink = ({ v }: { v?: V | { id: string; no: number; year: number } | null }) => (v ? <Link href={`/muhasebe/fisler/${v.id}`} className="text-sm font-semibold text-brand-700">Fiş {v.year}/{v.no}{"total" in v ? ` · ${m(v.total)}` : ""}</Link> : null);

/** Dönem sonu sihirbazı: aylık, çeyrek sonu ve yıl sonu muhasebe işlemleri sırayla */
export default async function PeriodEnd({ searchParams }: { searchParams: Promise<{ ay?: string; oran?: string; reesk?: string; cek?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const now = new Date(Date.now() + 3 * 3600000);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const month = sp.ay && /^\d{4}-\d{2}$/.test(sp.ay) ? sp.ay : prev;
  const year = Number(month.slice(0, 4));
  const supabase = await createClient();
  const [{ data, error }, { data: chk }] = await Promise.all([supabase.rpc("gl_period_checklist", { p_month: month }), supabase.rpc("gl_checks", { p_month: month })]);
  const openChecks = ((chk ?? []) as Array<{ severity: string; count: number; acked: boolean }>).filter((x) => x.count > 0 && !x.acked);
  const openCrit = openChecks.filter((x) => x.severity === "critical").length;
  const c = (data ?? null) as Check | null;
  const canEdit = (s.modules.ledger ?? 0) >= 2 && !c?.locked;
  const rate = sp.oran && /^\d+([.,]\d+)?$/.test(sp.oran) ? Number(sp.oran.replace(",", ".")) : null;
  const rrate = sp.reesk && /^\d+([.,]\d+)?$/.test(sp.reesk) ? Number(sp.reesk.replace(",", ".")) : null;
  const cap = c ? severanceCapAt(c.end) : null;
  const [defs, accr, rev, rd, sev] = c ? await Promise.all([
    supabase.from("gl_deferrals").select("id, kind, description, total, start_month, months, pl_code").order("start_month", { ascending: false }).limit(100),
    supabase.rpc("gl_loan_accrual_calc", { p_month: month }),
    c.quarter_end && rate ? supabase.rpc("gl_reval_preview", { p_date: c.end, p_rate: rate }) : Promise.resolve({ data: null }),
    c.quarter_end && rrate ? supabase.rpc("gl_rediscount_calc", { p_date: c.end, p_rate: rrate, p_cheques: sp.cek === "1" }) : Promise.resolve({ data: null }),
    c.quarter_end ? supabase.rpc("gl_severance_calc", { p_date: c.end, p_cap: cap }) : Promise.resolve({ data: null }),
  ]) : [null, null, null, null, null];
  const rdRows = ((rd?.data ?? null) as Array<{ direction: string; discount: number }> | null);
  const sevCalc = ((sev?.data ?? null) as { rows: Array<{ id: string; name: string; years: number; base: number; amount: number }>; total: number; booked: number; skipped: number; voucher: V | null } | null);
  const deferrals = ((defs?.data ?? []) as Def[]);
  const accrual = ((accr?.data ?? []) as Acc[]);
  const preview = ((rev?.data ?? null) as Rev[] | null);
  const v = c?.vouchers ?? {};
  let n = 0;
  return (
    <>
      <PageHeader title="Dönem sonu işlemleri" subtitle={`${month} · adımları sırayla yapın; her fiş yeniden oluşturulabilir`} actions={<Link href="/muhasebe/donem" className="text-sm font-semibold text-brand-700">Kapanış ve kilit</Link>} />
      <div className={page}>
        <form className="flex flex-wrap gap-2"><input type="month" name="ay" defaultValue={month} className={`${inputCls} w-44`} /><button className={btnSecondary}>Göster</button></form>
        {error && <Notice tone="bad">{/function|does not exist|schema cache|relation/.test(error.message) ? "Supabase'de 20270214000000_period_end.sql çalıştırılmalı." : glError(error.message)}</Notice>}
        {c?.locked && <Notice tone="info">Bu dönem kilitli: fiş eklenemez.</Notice>}
        {chk && openChecks.length > 0 && <Notice tone={openCrit ? "bad" : "warn"}>Kontrollerde {openCrit ? `${openCrit} kritik, ` : ""}{openChecks.length - openCrit} diğer açık uyarı var. <Link href={`/muhasebe/kontroller?ay=${month}`} className="font-semibold text-brand-700">Kontrolleri aç</Link>.</Notice>}
        {c && c.pending > 0 && <Notice tone="warn">Bu ay {c.pending} fiş onay ya da eşleştirme bekliyor; onaylanmayan fişler bakiyelere girmez. Dönem sonu işlemlerinden önce <Link href={`/muhasebe/gelen-kutusu?ay=${month}`} className="font-semibold text-brand-700">gelen kutusunu</Link> boşaltın.</Notice>}
        {c && (
          <>
            <h2 className="font-display text-lg font-semibold text-brand-800">Aylık</h2>

            <Step n={++n} title="Amortisman" desc="Demirbaşların aylık normal amortismanı (770 / 257). Yeniden değerlenmiş demirbaşlarda yeni değer üzerinden." state={c.depreciation.eligible === 0 ? (c.depreciation.done ? "ok" : "na") : "todo"}>
              <p className="text-sm">Bu ay ayrılan: <b>{c.depreciation.done}</b> demirbaş · bekleyen: <b>{c.depreciation.eligible}</b></p>
              {canEdit && c.depreciation.eligible > 0 && <form action={glDepreciationRun}><input type="hidden" name="month" value={month} /><PendingSubmit className={btnPrimary}>Amortismanı ayır</PendingSubmit></form>}
            </Step>

            <Step n={++n} title="Dönemsellik" desc="Peşin ödenen sigorta, kira, abonelik giderlerinin (180 / 280) ve peşin tahsil edilen gelirlerin (380 / 480) aya düşen payı." state={c.deferrals === 0 ? "na" : v[`pdefer:${month}`] ? "ok" : "todo"}>
              <VLink v={v[`pdefer:${month}`]} />
              {canEdit && c.deferrals > 0 && <form action={glDeferralsRun}><input type="hidden" name="month" value={month} /><PendingSubmit className={btnPrimary}>{v[`pdefer:${month}`] ? "Fişi yeniden oluştur" : "Dönemsellik fişini oluştur"}</PendingSubmit></form>}
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold text-brand-700">Dönemsellik kayıtları ({deferrals.length})</summary>
                <div className="mt-2 overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
                  <thead><tr className="text-xs text-muted"><th className={th}>Açıklama</th><th className={th}>Tür</th><th className={th}>Başlangıç</th><th className={`${th} text-right`}>Ay</th><th className={`${th} text-right`}>Toplam</th><th className={th}>Hesap</th>{canEdit && <th className={th} />}</tr></thead>
                  <tbody>
                    {deferrals.map((d) => <tr key={d.id}><td className={td}>{d.description}</td><td className={td}>{d.kind === "expense" ? "Gider (180/280)" : "Gelir (380/480)"}</td><td className={td}>{d.start_month.slice(0, 7)}</td><td className={tdNum}>{d.months}</td><td className={tdNum}>{m(d.total)}</td><td className={`${td} num`}>{d.pl_code}</td>
                      {canEdit && <td className={td}><form action={glDeferralDelete}><input type="hidden" name="id" value={d.id} /><ConfirmSubmit label="Sil" question="Kayıt ve kurulum fişi silinsin mi?" /></form></td>}</tr>)}
                    {!deferrals.length && <tr><td colSpan={7} className="py-4 text-center text-muted">Kayıt yok.</td></tr>}
                  </tbody>
                </table></div>
                {canEdit && (
                  <form action={glDeferralSave} className="mt-3 grid gap-3 md:grid-cols-3">
                    <Field label="Tür"><select name="kind" className={selectCls}><option value="expense">Peşin ödenen gider</option><option value="income">Peşin tahsil edilen gelir</option></select></Field>
                    <Field label="Açıklama"><input name="description" required maxLength={200} placeholder="ör. Kasko 2026-2027" className={inputCls} /></Field>
                    <Field label="Toplam tutar (TL)"><input name="total" required inputMode="decimal" className={inputCls} /></Field>
                    <Field label="İlk payın ayı"><input type="month" name="start_month" required defaultValue={month} className={inputCls} /></Field>
                    <Field label="Süre (ay)"><input name="months" required inputMode="numeric" defaultValue="12" className={inputCls} /></Field>
                    <Field label="Gider / gelir hesabı" hint="ödemenin yazıldığı hesap"><input name="pl_code" required defaultValue="770" className={inputCls} /></Field>
                    <Field label="Kurulum fişi tarihi" hint="ödeme tarihi; boşsa ilk ay"><input type="date" name="setup_date" className={inputCls} /></Field>
                    <div className="md:col-span-3"><PendingSubmit className={btnSecondary}>Ekle</PendingSubmit></div>
                    <p className="md:col-span-3 text-xs text-muted">Ödemeyi finansta her zamanki gibi gider olarak girin; burada tutar 180 (ilk 12 ay) ve 280&apos;e (sonrası) ayrılır, her ay payı yeniden gidere yazılır.</p>
                  </form>
                )}
              </details>
            </Step>

            <Step n={++n} title="Kredi faiz tahakkuku" desc="Ay sonuna kadar işlemiş ama ödenmemiş taksit faizi ve BSMV (780 / 381); ertesi ayın ilk günü ters kaydı otomatik." state={c.loans === 0 || !accrual.length ? "na" : v[`accint:${month}`] ? "ok" : "todo"}>
              {accrual.length > 0 && (
                <div className="overflow-x-auto"><table className="w-full text-sm min-w-[520px]">
                  <thead><tr className="text-xs text-muted"><th className={th}>Kredi</th><th className={th}>Taksit</th><th className={th}>Vade</th><th className={`${th} text-right`}>Faiz + vergi</th><th className={`${th} text-right`}>Tahakkuk (TL)</th></tr></thead>
                  <tbody>{accrual.map((a, i) => <tr key={i}><td className={td}>{a.loan}</td><td className={td}>{a.no}</td><td className={td}>{formatDate(a.due_date)}</td><td className={tdNum}>{fmt(a.interest, a.currency)}</td><td className={tdNum}>{m(a.accrued)}</td></tr>)}</tbody>
                </table></div>
              )}
              <VLink v={v[`accint:${month}`]} />
              {canEdit && accrual.length > 0 && <form action={glLoanAccrual}><input type="hidden" name="month" value={month} /><PendingSubmit className={btnPrimary}>{v[`accint:${month}`] ? "Fişi yeniden oluştur" : "Tahakkuk fişini oluştur"}</PendingSubmit></form>}
            </Step>

            <Step n={++n} title="Kur değerleme" desc="Döviz banka, kasa ve cari bakiyelerinin ay sonu kuruyla değerlenmesi (646 / 656)." state={c.fx ? "ok" : "todo"}>
              <div className="flex flex-wrap gap-4"><VLink v={c.fx} /><Link href="/muhasebe/donem" className="text-sm font-semibold text-brand-700">Kur değerleme →</Link></div>
            </Step>

            <Step n={++n} title="Kasa sayımı" desc="Ay sonunda kasalar sayılır; fark 197 (noksan) ya da 397 (fazla) olarak işlenir." state="na">
              <Link href={`/finans/kasa-sayim?tarih=${c.end}`} className="text-sm font-semibold text-brand-700">Kasa sayım tutanağı →</Link>
            </Step>

            <Step n={++n} title="Bordro tahakkuku ve damga vergisi" desc="Maaş tahakkuk fişi (770 / 335-360-361) ve ayın damga vergisi tahakkuku." state={v[`payroll:${month}`] ? "ok" : "todo"}>
              <div className="flex flex-wrap gap-4 text-sm"><VLink v={v[`payroll:${month}`]} /><VLink v={v[`stamp:${month}`]} />
                <Link href={`/muhasebe/beyanname?ay=${month}&sekme=muhtasar`} className="font-semibold text-brand-700">Bordro tahakkuku →</Link>
                <Link href={`/muhasebe/beyanname?ay=${month}&sekme=damga`} className="font-semibold text-brand-700">Damga vergisi →</Link></div>
            </Step>

            <Step n={++n} title="Gider yansıtma (7/A)" desc="710–780 gider hesaplarının yansıtma hesapları üzerinden 620–660'a aktarımı. Amortisman, dönemsellik ve tahakkuklardan sonra yapın." state={v[`reflect:${month}`] ? "ok" : "todo"}>
              <VLink v={v[`reflect:${month}`]} />
              {canEdit && <form action={glReflectMonth}><input type="hidden" name="month" value={month} /><PendingSubmit className={btnPrimary}>{v[`reflect:${month}`] ? "Fişi yeniden oluştur" : "Yansıtma fişini oluştur"}</PendingSubmit></form>}
            </Step>

            <Step n={++n} title="KDV mahsubu" desc="191 / 391 kapatılır, fark 360 ya da 190'a (KDV iadesi varsa 136)." state={v[`vat:${month}`] ? "ok" : "todo"}>
              <div className="flex flex-wrap gap-4"><VLink v={v[`vat:${month}`]} /><Link href={`/muhasebe/beyanname?ay=${month}&sekme=kdv`} className="text-sm font-semibold text-brand-700">KDV1 →</Link></div>
            </Step>

            {c.quarter_end && (
              <>
                <h2 className="font-display text-lg font-semibold text-brand-800 mt-2">{c.year_end ? "Yıl sonu" : `${c.quarter}. geçici vergi dönemi sonu`}</h2>
                <Step n={++n} title="Yeniden değerleme (VUK mük. 298/Ç)" desc="Önceki yıllarda aktifleştirilmiş amortismana tabi demirbaşların maliyeti ve birikmiş amortismanı ilan edilen oranla artırılır; fark 522'ye. Sonraki amortisman yeni değerden ayrılır." state={v[`reval:${c.end}`] ? "ok" : "todo"}>
                  <VLink v={v[`reval:${c.end}`]} />
                  {!v[`reval:${c.end}`] && (
                    <form className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="ay" value={month} />
                      <Field label="Oran (%)" hint="Hazine ve Maliye Bakanlığı ilan eder"><input name="oran" defaultValue={rate ?? ""} inputMode="decimal" placeholder="ör. 25,49" className={`${inputCls} w-32`} /></Field>
                      <button className={btnSecondary}>Önizle</button>
                    </form>
                  )}
                  {preview && !v[`reval:${c.end}`] && (
                    <>
                      <div className="overflow-x-auto"><table className="w-full text-sm min-w-[760px]">
                        <thead><tr className="text-xs text-muted"><th className={th}>Demirbaş</th><th className={th}>Aktifleştirme</th><th className={`${th} text-right`}>Maliyet</th><th className={`${th} text-right`}>Birikmiş amort.</th><th className={`${th} text-right`}>Maliyet artışı</th><th className={`${th} text-right`}>Amort. artışı</th><th className={`${th} text-right`}>522</th></tr></thead>
                        <tbody>
                          {preview.map((r) => <tr key={r.id}><td className={td}>{r.name}{r.tag ? <span className="text-xs text-muted"> · {r.tag}</span> : null}</td><td className={td}>{formatDate(r.purchase_date)}</td><td className={tdNum}>{m(r.cost)}</td><td className={tdNum}>{m(r.accum)}</td><td className={tdNum}>{m(r.cost_inc)}</td><td className={tdNum}>{m(r.accum_inc)}</td><td className={tdNum}>{m(r.fund)}</td></tr>)}
                          {!preview.length && <tr><td colSpan={7} className="py-4 text-center text-muted">Uygun demirbaş yok (bu yıl alınanlar ve tamamen amorti olanlar hariç).</td></tr>}
                          {preview.length > 0 && <tr className="font-semibold"><td className={td} colSpan={6}>Toplam değer artışı</td><td className={tdNum}>{m(preview.reduce((x, r) => x + Number(r.fund), 0))}</td></tr>}
                        </tbody>
                      </table></div>
                      {canEdit && preview.length > 0 && <form action={glRevalPost}><input type="hidden" name="date" value={c.end} /><input type="hidden" name="rate" value={String(rate)} /><PendingSubmit className={btnPrimary}>%{String(rate).replace(".", ",")} ile yeniden değerle</PendingSubmit></form>}
                    </>
                  )}
                  {v[`reval:${c.end}`] && (s.modules.ledger ?? 0) >= 3 && !c.locked && <form action={glRevalUndo}><input type="hidden" name="date" value={c.end} /><ConfirmSubmit label="Yeniden değerlemeyi geri al" question="Demirbaş değerleri ve fiş geri alınsın mı?" /></form>}
                  <p className="text-xs text-muted">2025, 2026 ve 2027&apos;de enflasyon düzeltmesi yapılmadığından yeniden değerleme yapılabilir. İsteğe bağlıdır; geçmiş dönemler için yapılamaz.</p>
                </Step>
                <Step n={++n} title="Reeskont" desc="Vadesi dönem sonundan sonra olan alacak / borç senetlerinin (isteğe bağlı vadeli çeklerin) iç iskontoyla değerlemesi: 657 / 122 ve 322 / 647; ertesi gün ters kaydı otomatik." state={v[`reesk:${c.end}`] ? "ok" : "todo"}>
                  <VLink v={v[`reesk:${c.end}`]} />
                  <form className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="ay" value={month} />{rate ? <input type="hidden" name="oran" value={String(rate)} /> : null}
                    <Field label="TCMB reeskont faiz oranı (%)"><input name="reesk" defaultValue={rrate ?? ""} inputMode="decimal" placeholder="ör. 45" className={`${inputCls} w-32`} /></Field>
                    <label className="flex items-center gap-2 text-sm h-11"><input type="checkbox" name="cek" value="1" defaultChecked={sp.cek === "1"} /> Vadeli çekleri de dahil et</label>
                    <button className={btnSecondary}>Hesapla</button>
                  </form>
                  {rdRows && (
                    <>
                      <p className="text-sm">{rdRows.length} belge · alacak reeskontu <b>{m(rdRows.filter((r) => r.direction === "in").reduce((x, r) => x + Number(r.discount), 0))}</b> · borç reeskontu <b>{m(rdRows.filter((r) => r.direction === "out").reduce((x, r) => x + Number(r.discount), 0))}</b></p>
                      {canEdit && rdRows.length > 0 && <form action={glRediscountPost}><input type="hidden" name="date" value={c.end} /><input type="hidden" name="rate" value={String(rrate)} /><input type="hidden" name="cheques" value={sp.cek === "1" ? "1" : "0"} /><PendingSubmit className={btnPrimary}>{v[`reesk:${c.end}`] ? "Fişi yeniden oluştur" : "Reeskont fişini oluştur"}</PendingSubmit></form>}
                    </>
                  )}
                </Step>
                <Step n={++n} title="Kıdem tazminatı karşılığı" desc="1 yılını doldurmuş sigortalı çalışanların son resmi brüt ücreti (tavanla sınırlı) × hizmet yılı; fark gider / 472. Karşılık gideri vergi hesabına KKEG olarak eklenir." state={!sevCalc || (!sevCalc.total && !sevCalc.booked) ? "na" : sevCalc.voucher ? "ok" : "todo"}>
                  {sevCalc && (
                    <>
                      <p className="text-sm">{sevCalc.rows.length} çalışan · hesaplanan <b>{m(sevCalc.total)}</b> · kayıtlı (472) <b>{m(sevCalc.booked)}</b> · fark <b>{m(sevCalc.total - sevCalc.booked)}</b>{cap ? <span className="text-muted"> · tavan {m(cap)}</span> : null}{sevCalc.skipped ? <span className="text-[#B45309]"> · {sevCalc.skipped} kişinin bordrosu yok</span> : null}</p>
                      <VLink v={sevCalc.voucher} />
                      {canEdit && (sevCalc.total || sevCalc.booked) ? <form action={glSeverancePost} className="flex flex-wrap items-end gap-2"><input type="hidden" name="date" value={c.end} /><input type="hidden" name="cap" value={cap ? (cap / 100).toFixed(2).replace(".", ",") : ""} /><Field label="Gider hesabı"><input name="expense" defaultValue="770" className={`${inputCls} w-28`} /></Field><PendingSubmit className={btnPrimary}>{sevCalc.voucher ? "Fişi yeniden oluştur" : "Karşılık fişini oluştur"}</PendingSubmit></form> : null}
                    </>
                  )}
                </Step>
                <Step n={++n} title="Şüpheli alacaklar" desc="Dava / icra safhasındaki ya da tahsili şüpheli hale gelen müşteri alacakları için 128 / 129 / 654." state="na">
                  <Link href="/muhasebe/supheli-alacak" className="text-sm font-semibold text-brand-700">Şüpheli alacaklar →</Link>
                </Step>
                <Step n={++n} title={c.year_end ? "Kurumlar vergisi karşılığı" : "Geçici vergi"} desc={c.year_end ? "691 / 370 ve peşin ödenen vergilerin mahsubu (371 / 193)." : "Dönem kârı üzerinden geçici vergi (193 / 360)."} state={(c.year_end ? v[`cit:${year}`] : v[`gecici:${year}-Q${c.quarter}`]) ? "ok" : "todo"}>
                  <div className="flex flex-wrap gap-4"><VLink v={c.year_end ? v[`cit:${year}`] : v[`gecici:${year}-Q${c.quarter}`]} /><Link href={`/muhasebe/vergi?yil=${year}&donem=${c.year_end ? 4 : c.quarter}`} className="text-sm font-semibold text-brand-700">Vergi hesabı →</Link></div>
                </Step>
              </>
            )}

            {c.year_end && (
              <>
                <Step n={++n} title="131 / 331 aktarımı" desc="Yıl sonunda borç bakiyesi veren ortak hesapları (331) Ortaklardan Alacaklar'a (131) aktarılır; 1 Ocak'ta ters kayıt otomatik." state={v[`p131:${year}`] ? "ok" : "todo"}>
                  <VLink v={v[`p131:${year}`]} />
                  {canEdit && <form action={glPartnerReclass}><input type="hidden" name="year" value={year} /><PendingSubmit className={btnPrimary}>{v[`p131:${year}`] ? "Yeniden hesapla" : "Aktarım fişini oluştur"}</PendingSubmit></form>}
                </Step>
                <Step n={++n} title="Yıl sonu kapanış" desc="7 sınıfı, gelir tablosu ve bilanço kapanışı; yeni yıl açılış fişi." state={v[`close69:${year}`] ? "ok" : "todo"}>
                  <Link href="/muhasebe/donem" className="text-sm font-semibold text-brand-700">Kapanış ve kilit →</Link>
                </Step>
              </>
            )}
            {!c.quarter_end && <p className="text-xs text-muted">Yeniden değerleme ve geçici vergi adımları Mart, Haziran, Eylül ve Aralık aylarında görünür; 131 / 331 aktarımı ve kapanış Aralık&apos;ta.</p>}
          </>
        )}
      </div>
    </>
  );
}
