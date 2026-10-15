import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Field, KPI, Notice, btnPrimary, btnSecondary, inputCls, page, selectCls } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { glBackfill, glOpening, glRepost, glSaveSettings } from "@/lib/gl-actions";

export const dynamic = "force-dynamic";

type O = {
  settings: { enabled: boolean; start_date: string; lock_date: string | null; exclude_codes: string[]; export_format: string; exclude_cash_salary?: boolean; babs_limit?: number } | null;
  posted: number; pending: number; excluded: number; unposted: number; accounts: number; month: { debit: number; vouchers: number };
};

const LINKS: Array<[string, string, string]> = [
  ["/muhasebe/kokpit", "Muhasebe kokpiti", "Ayın kapanışı 6 aşamada: sıradaki iş ve eksikler tek ekranda"],
  ["/muhasebe/paket", "Mali müşavir paketi", "Ayın raporları ve Luca dosyaları: ZIP indir veya e-postayla gönder"],
  ["/muhasebe/karsilastirma", "Karşılaştırmalı raporlar", "Gelir tablosu beş dönem yan yana"],
  ["/muhasebe/nakit-akis", "Nakit akış tablosu", "İşletme, yatırım ve finansman nakit akışları"],
  ["/muhasebe/gelen-kutusu", "Fiş onayı (gelen kutusu)", "ERP'den gelen fiş taslaklarını kontrol edip onaylayın"],
  ["/muhasebe/fisler", "Muhasebe fişleri", "Otomatik ve elle fişler, eşleştirme bekleyenler"],
  ["/muhasebe/hesap-plani", "Hesap planı", "Tek Düzen Hesap Planı, alt hesaplar, içe aktarma"],
  ["/muhasebe/eslestirme", "Eşleştirme", "Kasa, banka, kart, cari, kategori → hesap kodu"],
  ["/muhasebe/mizan", "Mizan", "Dönem mizanı, seviye, karşılaştırmalı"],
  ["/muhasebe/kebir", "Muavin / kebir", "Hesap ekstresi, defter-i kebir"],
  ["/muhasebe/yevmiye", "Yevmiye defteri", "Tarih sırasıyla madde madde"],
  ["/muhasebe/bilanco", "Bilanço", "Aktif / pasif, Tek Düzen biçimi"],
  ["/muhasebe/gelir-tablosu", "Gelir tablosu", "Brüt satıştan dönem net kârına"],
  ["/muhasebe/beyanname", "Beyanname hazırlık", "KDV1, KDV2, muhtasar, damga vergisi, KDV iadesi"],
  ["/muhasebe/kontroller", "Kontroller ve uyarılar", "Ay sonu öncesi eksik ve hatalı kayıtları yakalar"],
  ["/muhasebe/luca", "Luca aktarımı", "Onaylı fişleri Luca'ya aktarılacak Excel dosyasına çevirir"],
  ["/muhasebe/donem-sonu", "Dönem sonu işlemleri", "Amortisman, dönemsellik, faiz, yansıtma, yeniden değerleme"],
  ["/muhasebe/vergi", "Geçici ve kurumlar vergisi", "KKEG, ihracat indirimi, asgari vergi, fişler"],
  ["/mevzuat", "Mevzuat ve gelişmeler", "Muhasebe, vergi, SGK gelişmeleri ve yapılacaklar"],
  ["/muhasebe/vergi-takvimi", "Vergi takvimi", "Son günler ve beyanname durumları"],
  ["/muhasebe/donem", "Dönem işlemleri", "Kur değerleme, bordro tahakkuku, kapanış / açılış, kilit"],
  ["/muhasebe/aktar", "Aktarım", "Fişleri Luca / Zirve / Excel'e aktar"],
];

/** Genel muhasebe ana sayfası */
export default async function LedgerHome() {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const supabase = await createClient();
  const [{ data, error }, { count: drafts }, { data: wm }] = await Promise.all([supabase.rpc("gl_overview"), supabase.from("gl_vouchers").select("id", { count: "exact", head: true }).eq("status", "draft"), supabase.rpc("gl_working_month")]);
  const ck = typeof wm === "string" ? ((await supabase.rpc("gl_cockpit", { p_month: wm })).data as { done: number; next: { label: string; link: string; stage: string } | null } | null) : null;
  const o = (data ?? null) as O | null;
  const set = o?.settings ?? null;
  const admin = (s.modules.ledger ?? 0) >= 3;
  return (
    <>
      <PageHeader title="Genel muhasebe" subtitle="ERP'deki fatura, ödeme, banka, kart ve maaş kayıtları arka planda muhasebe fişine döner" actions={(s.modules.ledger ?? 0) >= 2 ? <Link href="/muhasebe/fisler/yeni" className="text-sm font-semibold text-brand-700">+ Elle fiş</Link> : undefined} />
      <div className={page}>
        {error && <Notice tone="bad">Supabase&apos;de 20270206000000_gl_core.sql çalıştırılmalı.</Notice>}
        {o && !set?.enabled && <Notice tone="warn">Genel muhasebe kapalı. Aşağıdan başlangıç tarihini seçip açın; o tarihten sonraki ERP kayıtları otomatik fişe döner. Geçmiş kayıtlar için &quot;Geçmişi fişe çevir&quot;i kullanın.</Notice>}
        {o && (
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <KPI label="Onay bekleyen fiş" value={(drafts ?? 0).toLocaleString("tr-TR")} tone={drafts ? "bad" : undefined} href="/muhasebe/gelen-kutusu" sub="gelen kutusu" />
            <KPI label="Kayıtlı fiş" value={o.posted.toLocaleString("tr-TR")} href="/muhasebe/fisler" />
            <KPI label="Eşleştirme bekleyen" value={o.pending.toLocaleString("tr-TR")} tone={o.pending ? "bad" : undefined} href="/muhasebe/fisler?durum=pending" sub="hesap kodu tanımlanınca kaydolur" />
            <KPI label="Fişe dönmemiş ERP kaydı" value={o.unposted.toLocaleString("tr-TR")} tone={o.unposted ? "bad" : undefined} sub="geçmişi fişe çevirin" />
            <KPI label="Muhasebe dışı" value={o.excluded.toLocaleString("tr-TR")} href="/muhasebe/fisler?durum=excluded" sub="fişli cari, iç hesap" />
            <KPI label="Bu ay" value={fmt(o.month.debit)} sub={`${o.month.vouchers} fiş · borç toplamı`} />
          </div>
        )}
        {ck && typeof wm === "string" && (
          <Link href={`/muhasebe/kokpit?ay=${wm}`} className="rounded-[14px] border border-brand-600 bg-[#EEF3F9] p-4 flex flex-wrap items-center gap-3 hover:bg-[#E3ECF6]">
            <b>Muhasebe kokpiti · {wm}</b><span className="text-sm">{ck.done} / 6 aşama tamam</span>
            {ck.next ? <span className="text-sm text-muted">Sıradaki: {ck.next.label} ({ck.next.stage})</span> : <span className="text-sm text-[#1A7F52]">Ayın işleri tamam</span>}
            <span className="ml-auto text-sm font-semibold text-brand-700">Aç →</span>
          </Link>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          {LINKS.map(([h, l, d]) => (
            <Link key={h} href={h} className="rounded-[14px] border border-line bg-white p-4 hover:border-brand-600"><b className="block">{l}</b><span className="text-xs text-muted">{d}</span></Link>
          ))}
        </div>
        {o && (
          <div className="grid gap-4 lg:grid-cols-2">
            {admin && (
              <Card title="Ayarlar">
                <form action={glSaveSettings} className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm font-semibold md:col-span-2"><input type="checkbox" name="enabled" defaultChecked={set?.enabled} /> Genel muhasebe açık (otomatik muhasebeleştirme)</label>
                  <Field label="Başlangıç tarihi" hint="öncesi açılış fişiyle girilir"><input type="date" name="start_date" defaultValue={set?.start_date ?? ""} className={inputCls} /></Field>
                  <Field label="Aktarım biçimi"><select name="export_format" defaultValue={set?.export_format ?? "luca"} className={selectCls}><option value="luca">Luca</option><option value="zirve">Zirve</option><option value="generic">Genel Excel</option></select></Field>
                  <Field label="Muhasebe dışı kategori kodları" hint="virgülle; bu kategorideki kayıtlar fişe dönmez" className="md:col-span-2"><input name="exclude_codes" defaultValue={(set?.exclude_codes ?? []).join(", ")} className={inputCls} /></Field>
                  <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" name="exclude_cash_salary" defaultChecked={set?.exclude_cash_salary} /> Elden maaş ödemeleri muhasebe dışı (yalnız banka ile ödenen maaş 335&apos;e işlenir)</label>
                  <Field label="Cari mutabakat sınırı (TL)" hint="KDV hariç, eski Ba-Bs"><input name="babs_limit" inputMode="decimal" defaultValue={String((set?.babs_limit ?? 500000) / 100)} className={inputCls} /></Field>
                  <p className="text-xs text-muted md:col-span-2">Dönem kilidi: {set?.lock_date ? formatDate(set.lock_date) : "yok"} (Dönem işlemleri). Fişli carilerin ve fişli-faturalı yansıtma kayıtlarının hepsi her zaman muhasebe dışıdır.</p>
                  <div className="md:col-span-2"><PendingSubmit className={btnPrimary}>Kaydet</PendingSubmit></div>
                </form>
              </Card>
            )}
            {admin && set?.enabled && (
              <Card title="Kurulum adımları">
                <ol className="list-decimal pl-5 text-sm flex flex-col gap-1">
                  <li><Link href="/muhasebe/hesap-plani" className="text-brand-700">Hesap planını</Link> gözden geçirin; kendi alt hesaplarınızı ekleyin ya da Excel&apos;den yapıştırın.</li>
                  <li><Link href="/muhasebe/eslestirme" className="text-brand-700">Eşleştirmeyi</Link> kontrol edin: hangi kategori hangi gider / gelir hesabına.</li>
                  <li>Başlangıçtaki bakiyeler için açılış fişi taslağı oluşturun.</li>
                  <li>Geçmiş kayıtları fişe çevirin; eşleştirme bekleyenleri tamamlayın.</li>
                </ol>
                <form action={glOpening} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
                  <Field label="Açılış farkı karşı hesabı"><input name="counter" defaultValue="500" className={`${inputCls} w-28`} /></Field>
                  <PendingSubmit className={btnSecondary}>Açılış fişi taslağı</PendingSubmit>
                </form>
                <form action={glBackfill} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
                  <Field label="Başlangıç"><input type="date" name="from" defaultValue={set.start_date} className={inputCls} /></Field>
                  <Field label="Bitiş"><input type="date" name="to" className={inputCls} /></Field>
                  <PendingSubmit className={btnSecondary}>Geçmişi fişe çevir</PendingSubmit>
                </form>
                <form action={glRepost} className="border-t border-line pt-3"><PendingSubmit className={btnSecondary}>Bekleyenleri yeniden dene</PendingSubmit></form>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
}
