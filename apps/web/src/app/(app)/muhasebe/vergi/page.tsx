import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Field, KPI, Notice, Tabs, btnPrimary, btnSecondary, inputCls, page, selectCls, td, tdNum, th } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { glError } from "@/lib/gl";
import { glCitPost, glKkegSet, glTaxAdjDelete, glTaxAdjSave } from "@/lib/gl-actions";

export const dynamic = "force-dynamic";

type Adj = { id: string; date: string; kind: string; description: string; amount: number; min_allowed: boolean };
type Calc = {
  year: number; q: number; from: string; to: string; profit: number; kkeg_auto: number; kkeg_manual: number; kkeg: number;
  kkeg_accounts: Array<{ code: string; name: string; pct: number; expense: number; amount: number }>;
  base: number; deductions: number; deductions_min: number; loss: number; matrah: number; sales_export: number; sales_total: number; export_ratio: number; export_matrah: number;
  tax_normal: number; min_base: number; export_cut: number; tax_min: number; min_applies: boolean; tax: number; prior: number; prepaid: number; prepaid_193: number; payable: number;
  voucher: { id: string; no: number; year: number; total: number } | null; adjustments: Adj[];
};

const ADJ: Record<string, string> = { kkeg: "KKEG (eklenecek)", deduction: "İndirim / istisna", loss: "Geçmiş yıl zararı", prepaid: "Mahsup edilecek vergi (stopaj vb.)" };
const m = (v: number) => fmt(v);

/** Geçici vergi ve kurumlar vergisi hesabı */
export default async function CorporateTax({ searchParams }: { searchParams: Promise<{ yil?: string; donem?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const now = new Date(Date.now() + 3 * 3600000);
  // varsayılan: son biten geçici vergi dönemi
  const curQ = Math.floor(now.getUTCMonth() / 3);
  const defYear = curQ === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const defQ = curQ === 0 ? 4 : curQ;
  const year = /^\d{4}$/.test(sp.yil ?? "") ? Number(sp.yil) : defYear;
  const q = ["1", "2", "3", "4"].includes(sp.donem ?? "") ? Number(sp.donem) : defQ;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_cit_calc", { p_year: year, p_q: q });
  const c = (data ?? null) as Calc | null;
  const canEdit = (s.modules.ledger ?? 0) >= 2;
  const link = (y: number, d: number) => `/muhasebe/vergi?yil=${y}&donem=${d}`;
  const annual = q === 4;
  const rows: Array<[string, number, string?]> = c ? [
    ["Ticari bilanço kârı (yıl başından)", c.profit, "6 ve 7 sınıfı hesaplar"],
    ["+ Kanunen kabul edilmeyen giderler (KKEG)", c.kkeg, c.kkeg_manual ? `hesaplardan ${m(c.kkeg_auto)} · elle ${m(c.kkeg_manual)}` : undefined],
    ["= Kurum kazancı", c.base],
    ["− İndirim ve istisnalar", c.deductions],
    ["− Geçmiş yıl zararları", c.loss],
    ["= Vergi matrahı", c.matrah],
    ["  bunun ihracat kazancına düşen kısmı", c.export_matrah, `satışların %${(Number(c.export_ratio) * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}'i ihracat (601)`],
    ["Hesaplanan kurumlar vergisi", c.tax_normal, "%25 · ihracat kısmı %20"],
    ["Yurt içi asgari kurumlar vergisi", c.tax_min, `%10 × ${m(c.min_base)} − ihracat indirimi ${m(c.export_cut)}`],
    [annual ? "= Kurumlar vergisi" : "= Dönem vergisi", c.tax, c.min_applies ? "asgari vergi uygulandı" : undefined],
    ...(annual ? [["− Peşin ödenen vergiler (193)", c.prepaid_193, "geçici vergiler ve kesintiler"] as [string, number, string]]
      : [["− Önceki dönemlerde tahakkuk eden geçici vergi", c.prior] as [string, number], ["− Mahsup edilecek diğer vergiler", c.prepaid] as [string, number]]),
    [annual ? (c.payable >= 0 ? "= Ödenecek kurumlar vergisi" : "= İade / mahsup edilecek") : "= Ödenecek geçici vergi", Math.abs(c.payable)],
  ] : [];
  return (
    <>
      <PageHeader title="Geçici ve kurumlar vergisi" subtitle="A.Ş. · tahmini hesap; beyannameyi mali müşavir verir" actions={<Link href="/muhasebe/vergi-takvimi" className="text-sm font-semibold text-brand-700">Vergi takvimi</Link>} />
      <div className={page}>
        <div className="flex flex-wrap items-center gap-3">
          <Tabs active={link(year, q)} items={[[link(year, 1), "1. dönem (Oca–Mar)"], [link(year, 2), "2. dönem (Nis–Haz)"], [link(year, 3), "3. dönem (Tem–Eyl)"], [link(year, 4), "Yıllık (kurumlar)"]]} />
          <form className="ml-auto flex gap-2"><input type="hidden" name="donem" value={q} /><input name="yil" defaultValue={year} inputMode="numeric" className={`${inputCls} w-24`} /><button className={btnSecondary}>Yıl</button></form>
        </div>
        {error && <Notice tone="bad">{/function|does not exist|schema cache|relation|column/.test(error.message) ? "Supabase'de 20270213000000_corporate_tax.sql çalıştırılmalı." : glError(error.message)}</Notice>}
        {c && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KPI label="Ticari kâr" value={m(c.profit)} tone={c.profit < 0 ? "bad" : undefined} sub={`${formatDate(c.from)} – ${formatDate(c.to)}`} />
              <KPI label="Vergi matrahı" value={m(c.matrah)} />
              <KPI label={annual ? "Kurumlar vergisi" : "Dönem vergisi (kümülatif)"} value={m(c.tax)} sub={c.min_applies ? "asgari vergi" : undefined} />
              <KPI label={annual ? (c.payable >= 0 ? "Ödenecek" : "İade / mahsup") : "Ödenecek geçici vergi"} value={m(Math.abs(c.payable))} tone={c.payable > 0 ? "bad" : "ok"} sub={annual ? "izleyen yılın Nisan sonu" : "dönemi izleyen 2. ayın 17'si"} />
            </div>

            <Card title={annual ? `${year} kurumlar vergisi hesabı` : `${year} / ${q}. dönem geçici vergi hesabı`}>
              <div className="overflow-x-auto"><table className="w-full text-sm min-w-[620px]">
                <tbody>{rows.map(([l, v, note], i) => (
                  <tr key={i} className={l.startsWith("=") ? "font-semibold" : ""}><td className={td}>{l}{note ? <span className="ml-2 text-xs font-normal text-muted">{note}</span> : null}</td><td className={tdNum}>{m(v)}</td></tr>
                ))}</tbody>
              </table></div>
              <p className="text-xs text-muted">7/A gider hesapları (710–770) dönem kârına doğrudan katılır. 2025, 2026 ve 2027 hesap dönemlerinde enflasyon düzeltmesi yapılmıyor. Asgari kurumlar vergisinde geçmiş yıl zararı düşülmez; yalnızca kanunda sayılan istisnalar düşülebilir (aşağıda işaretleyin). Faaliyete yeni başlayan kurumlar ilk üç hesap döneminde asgari vergiden muaftır.</p>
            </Card>

            <Card title="Fiş">
              {c.voucher && <p className="text-sm">Fiş: <Link href={`/muhasebe/fisler/${c.voucher.id}`} className="font-semibold text-brand-700">{c.voucher.year}/{c.voucher.no}</Link> · {m(c.voucher.total)}</p>}
              <p className="text-sm text-muted">{annual ? "691 Dönem kârı vergi karşılığı borç / 370 alacak; peşin ödenen vergiler 371 borç / 193 alacak. Yıl sonu kapanışından önce oluşturun." : "193 Peşin ödenen vergiler borç / 360 Ödenecek vergi alacak. Ödemeyi finansta \"Vergi dairesine ödeme\" kategorisiyle girin."}</p>
              {canEdit && <form action={glCitPost}><input type="hidden" name="year" value={year} /><input type="hidden" name="q" value={q} /><PendingSubmit className={btnPrimary}>{c.voucher ? "Fişi yeniden oluştur" : annual ? "Vergi karşılığı fişini oluştur" : "Geçici vergi fişini oluştur"}</PendingSubmit></form>}
            </Card>

            <Card title="KKEG hesapları">
              <div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px]">
                <thead><tr className="text-xs text-muted"><th className={th}>Hesap</th><th className={`${th} text-right`}>Oran</th><th className={`${th} text-right`}>Gider (dönem)</th><th className={`${th} text-right`}>KKEG</th></tr></thead>
                <tbody>
                  {c.kkeg_accounts.map((a) => <tr key={a.code}><td className={td}><span className="num font-semibold">{a.code}</span> {a.name}</td><td className={tdNum}>%{Number(a.pct)}</td><td className={tdNum}>{m(a.expense)}</td><td className={tdNum}>{m(a.amount)}</td></tr>)}
                  {!c.kkeg_accounts.length && <tr><td colSpan={4} className="py-4 text-center text-muted">İşaretli hesap yok ya da bu dönemde gider yok.</td></tr>}
                </tbody>
              </table></div>
              {canEdit && (
                <form action={glKkegSet} className="flex flex-wrap items-end gap-2">
                  <Field label="Hesap kodu"><input name="code" required placeholder="ör. 770.05" className={`${inputCls} w-36`} /></Field>
                  <Field label="KKEG oranı" hint="%; 0 = listeden çıkar"><input name="pct" required inputMode="decimal" placeholder="30" className={`${inputCls} w-28`} /></Field>
                  <PendingSubmit className={btnSecondary}>Kaydet</PendingSubmit>
                </form>
              )}
              <p className="text-xs text-muted">Örnek: binek otomobil giderleri için ayrı bir alt hesap açıp %30 yazın; cezalar, bağışların sınırı aşan kısmı gibi tamamı kabul edilmeyen giderler için %100. Hesaba bağlanamayan kalemleri aşağıdan elle ekleyin.</p>
            </Card>

            <Card title="Elle düzeltmeler">
              <div className="overflow-x-auto"><table className="w-full text-sm min-w-[620px]">
                <thead><tr className="text-xs text-muted"><th className={th}>Tarih</th><th className={th}>Tür</th><th className={th}>Açıklama</th><th className={`${th} text-right`}>Tutar</th>{canEdit && <th className={th} />}</tr></thead>
                <tbody>
                  {c.adjustments.map((a) => (
                    <tr key={a.id}><td className={td}>{formatDate(a.date)}</td><td className={td}>{ADJ[a.kind] ?? a.kind}{a.kind === "deduction" && a.min_allowed ? <span className="text-xs text-muted"> · asgaride de düşülür</span> : null}</td><td className={td}>{a.description}</td><td className={tdNum}>{m(a.amount)}</td>
                      {canEdit && <td className={td}><form action={glTaxAdjDelete}><input type="hidden" name="id" value={a.id} /><ConfirmSubmit label="Sil" question="Silinsin mi?" /></form></td>}</tr>
                  ))}
                  {!c.adjustments.length && <tr><td colSpan={5} className="py-4 text-center text-muted">Bu yıl düzeltme yok.</td></tr>}
                </tbody>
              </table></div>
              {canEdit && (
                <form action={glTaxAdjSave} className="grid gap-3 md:grid-cols-[150px_220px_1fr_150px_auto] items-end">
                  <Field label="Tarih"><input type="date" name="adj_date" required defaultValue={c.to} className={inputCls} /></Field>
                  <Field label="Tür"><select name="kind" className={selectCls}>{Object.entries(ADJ).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                  <Field label="Açıklama"><input name="description" required maxLength={200} placeholder="ör. 2025 yılı zararı" className={inputCls} /></Field>
                  <Field label="Tutar (TL)"><input name="amount" required inputMode="decimal" className={inputCls} /></Field>
                  <PendingSubmit className={btnSecondary}>Ekle</PendingSubmit>
                  <label className="md:col-span-5 flex items-center gap-2 text-sm"><input type="checkbox" name="min_allowed" /> İndirim / istisna asgari kurumlar vergisi matrahından da düşülebilir (iştirak kazancı, Ar-Ge indirimi vb.)</label>
                </form>
              )}
              <p className="text-xs text-muted">Düzeltmeler tarihine göre o tarihi içeren dönemden itibaren hesaba girer: geçmiş yıl zararını yılın ilk gününe yazın.</p>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
