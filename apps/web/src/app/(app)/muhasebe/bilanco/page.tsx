import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, btnSecondary, inputCls, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { glError } from "@/lib/gl";

export const dynamic = "force-dynamic";

type R = { code: string; name: string; side: "aktif" | "pasif"; amount: number };
const GROUP: Record<string, string> = {
  "1": "I. DÖNEN VARLIKLAR", "2": "II. DURAN VARLIKLAR", "3": "III. KISA VADELİ YABANCI KAYNAKLAR", "4": "IV. UZUN VADELİ YABANCI KAYNAKLAR", "5": "V. ÖZKAYNAKLAR",
  "10": "A. Hazır Değerler", "11": "B. Menkul Kıymetler", "12": "C. Ticari Alacaklar", "13": "D. Diğer Alacaklar", "15": "E. Stoklar", "17": "F. Yıllara Yaygın İnşaat ve Onarım Maliyetleri", "18": "G. Gelecek Aylara Ait Giderler ve Gelir Tahakkukları", "19": "H. Diğer Dönen Varlıklar",
  "22": "A. Ticari Alacaklar", "23": "B. Diğer Alacaklar", "24": "C. Mali Duran Varlıklar", "25": "D. Maddi Duran Varlıklar", "26": "E. Maddi Olmayan Duran Varlıklar", "27": "F. Özel Tükenmeye Tabi Varlıklar", "28": "G. Gelecek Yıllara Ait Giderler ve Gelir Tahakkukları", "29": "H. Diğer Duran Varlıklar",
  "30": "A. Mali Borçlar", "32": "B. Ticari Borçlar", "33": "C. Diğer Borçlar", "34": "D. Alınan Avanslar", "35": "E. Yıllara Yaygın İnşaat ve Onarım Hakedişleri", "36": "F. Ödenecek Vergi ve Diğer Yükümlülükler", "37": "G. Borç ve Gider Karşılıkları", "38": "H. Gelecek Aylara Ait Gelirler ve Gider Tahakkukları", "39": "I. Diğer Kısa Vadeli Yabancı Kaynaklar",
  "40": "A. Mali Borçlar", "42": "B. Ticari Borçlar", "43": "C. Diğer Borçlar", "44": "D. Alınan Avanslar", "47": "E. Borç ve Gider Karşılıkları", "48": "F. Gelecek Yıllara Ait Gelirler ve Gider Tahakkukları", "49": "G. Diğer Uzun Vadeli Yabancı Kaynaklar",
  "50": "A. Ödenmiş Sermaye", "52": "B. Sermaye Yedekleri", "54": "C. Kâr Yedekleri", "57": "D. Geçmiş Yıllar Kârları", "58": "E. Geçmiş Yıllar Zararları (-)", "59": "F. Dönem Net Kârı (Zararı)",
};
const m = (v: number) => (v / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Side({ title, rows, classes }: { title: string; rows: R[]; classes: string[] }) {
  const total = rows.reduce((x, r) => x + Number(r.amount), 0);
  return (
    <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-1 text-sm">
      <h2 className="font-display text-lg font-bold mb-1">{title}</h2>
      {classes.map((c) => {
        const inC = rows.filter((r) => r.code.startsWith(c));
        if (!inC.length) return null;
        const groups = [...new Set(inC.map((r) => r.code.slice(0, 2)))];
        return (
          <div key={c} className="flex flex-col gap-0.5 mb-2">
            <div className="flex justify-between font-bold border-b border-line pb-1"><span>{GROUP[c]}</span><span className="num">{m(inC.reduce((x, r) => x + Number(r.amount), 0))}</span></div>
            {groups.map((g) => {
              const inG = inC.filter((r) => r.code.startsWith(g));
              return (
                <div key={g} className="flex flex-col">
                  <div className="flex justify-between font-semibold pl-3 pt-1"><span>{GROUP[g] ?? g}</span><span className="num">{m(inG.reduce((x, r) => x + Number(r.amount), 0))}</span></div>
                  {inG.map((r) => <div key={r.code} className="flex justify-between pl-7 text-[13px]"><Link href={`/muhasebe/kebir?hesap=${r.code}`} className="hover:text-brand-700"><span className="num text-muted mr-2">{r.code}</span>{r.name}</Link><span className={`num ${r.amount < 0 ? "text-bad" : ""}`}>{m(Number(r.amount))}</span></div>)}
                </div>
              );
            })}
          </div>
        );
      })}
      <div className="flex justify-between font-bold text-base border-t-2 border-ink pt-2 mt-auto"><span>{title} TOPLAMI</span><span className="num">{m(total)}</span></div>
    </section>
  );
}

/** Bilanço (Tek Düzen Hesap Planı biçimi) */
export default async function BalanceSheet({ searchParams }: { searchParams: Promise<{ tarih?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const date = sp.tarih && /^\d{4}-\d{2}-\d{2}$/.test(sp.tarih) ? sp.tarih : new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_balance_sheet", { p_date: date });
  const rows = (data ?? []) as R[];
  const a = rows.filter((r) => r.side === "aktif");
  const p = rows.filter((r) => r.side === "pasif");
  const ta = a.reduce((x, r) => x + Number(r.amount), 0);
  const tp = p.reduce((x, r) => x + Number(r.amount), 0);
  return (
    <>
      <PageHeader title="Bilanço" subtitle={`${formatDate(date)} tarihli · kayıtlı fişlerden; kapatılmamış dönem sonucu 590 / 591'de`} actions={<Link href="/muhasebe/gelir-tablosu" className="text-sm font-semibold text-brand-700">Gelir tablosu</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">{/function|does not exist|schema cache/.test(error.message) ? "Supabase'de 20270207000000_gl_reports.sql çalıştırılmalı." : glError(error.message)}</Notice>}
        <form className="flex items-end gap-2 print:hidden"><label className="flex flex-col gap-1 text-xs font-semibold text-muted">Tarih<input type="date" name="tarih" defaultValue={date} className={`${inputCls} w-44`} /></label><button className={btnSecondary}>Göster</button></form>
        {ta !== tp && rows.length > 0 && <Notice tone="bad">Aktif ({m(ta)}) ve pasif ({m(tp)}) toplamı tutmuyor: nazım hesaplar ya da dengesiz kayıt olabilir.</Notice>}
        {!rows.length && !error && <Notice tone="info">Bu tarihe kadar kayıtlı fiş yok.</Notice>}
        {rows.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Side title="AKTİF" rows={a} classes={["1", "2"]} />
            <Side title="PASİF" rows={p} classes={["3", "4", "5"]} />
          </div>
        )}
      </div>
    </>
  );
}
