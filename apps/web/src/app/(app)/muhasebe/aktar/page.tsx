import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Notice, btnPrimary, inputCls, page, selectCls } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { period } from "@/lib/gl";

export const dynamic = "force-dynamic";

/** Mali müşavir programına aktarım */
export default async function ExportPage({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const { from, to } = period(sp);
  const supabase = await createClient();
  const { data: st } = await supabase.from("gl_settings").select("export_format").maybeSingle();
  const f = (st?.export_format as string | undefined) ?? "luca";
  return (
    <>
      <PageHeader title="Aktarım" subtitle="Fişleri mali müşavirin programına aktarın; e-Defter orada imzalanıp GİB'e yüklenir" actions={<Link href="/muhasebe" className="text-sm font-semibold text-brand-700">Genel muhasebe</Link>} />
      <div className={page}>
        <Notice tone="info">e-Defter yalnız GİB&apos;in uyumluluk onayı verdiği yazılımla ve mali mühür / e-imzayla oluşturulabilir. Bu yüzden ERP fişleri hazırlar; mali müşavir Excel dosyasını Luca ya da Zirve&apos;nin &quot;Excel&apos;den fiş aktarma&quot; ekranında sütunları bir kez eşleştirerek içe alır.</Notice>
        <Card title="Fiş aktarım dosyası">
          <form action="/muhasebe/aktar/excel" className="grid gap-3 md:grid-cols-[repeat(3,minmax(0,200px))_auto] items-end">
            <input type="hidden" name="tur" value="fis" />
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Başlangıç<input type="date" name="bas" defaultValue={from} className={inputCls} /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Bitiş<input type="date" name="bit" defaultValue={to} className={inputCls} /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Biçim<select name="bicim" defaultValue={f} className={selectCls}><option value="luca">Luca (ayrıntılı sütunlar)</option><option value="zirve">Zirve</option><option value="generic">Genel Excel</option></select></label>
            <button className={btnPrimary}>Excel indir</button>
          </form>
          <ul className="text-sm text-muted list-disc pl-5">
            <li>Her satır bir fiş satırıdır: fiş no, tarih, fiş türü, hesap kodu, açıklama, borç, alacak, belge türü / no / tarih, döviz ve karşı tarafın VKN&apos;si.</li>
            <li>Aktarmadan önce yevmiye defterinden yılı numaralandırın; madde numaraları dosyaya yazılır.</li>
            <li>Mali müşavirin programında alt hesaplar (120.0001 gibi) yoksa önce hesap planını aktarın: Hesap planı sayfasındaki listeyi Excel&apos;e kopyalayabilirsiniz.</li>
          </ul>
        </Card>
        <Card title="Diğer çıktılar">
          <div className="flex flex-wrap gap-4 text-sm font-semibold">
            <a href={`/muhasebe/aktar/excel?tur=mizan&bas=${from}&bit=${to}&seviye=1`} className="text-brand-700">Mizan (ana hesap) ↓</a>
            <a href={`/muhasebe/aktar/excel?tur=mizan&bas=${from}&bit=${to}&seviye=3`} className="text-brand-700">Mizan (ayrıntılı) ↓</a>
            <Link href="/muhasebe/bilanco" className="text-brand-700">Bilanço</Link>
            <Link href="/muhasebe/gelir-tablosu" className="text-brand-700">Gelir tablosu</Link>
          </div>
        </Card>
      </div>
    </>
  );
}
