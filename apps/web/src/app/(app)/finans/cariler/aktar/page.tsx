import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { BhPartyImport } from "./BhPartyImport";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cari aktar" };

/** Bizim Hesap'tan müşteri / tedarikçi carilerini seçerek aktarma */
export default async function Page() {
  const s = await getSession();
  if (!((s.modules.finance ?? 0) >= 2 || (s.modules.sales ?? 0) >= 2 || (s.modules.purchases ?? 0) >= 2)) redirect("/finans/cariler");
  return (
    <>
      <PageHeader title="Cari aktar (Bizim Hesap)" subtitle="Müşteri ya da tedarikçi listesini Excel olarak yükleyin, aktarılacakları seçin"
        actions={<Link href="/finans/cariler" className="text-sm font-semibold text-brand-700">← Cari kartlar</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1100px]">
        <div className="text-sm text-muted rounded-[12px] border border-line bg-white p-4">
          Bizim Hesap&apos;ta <b>Müşteriler</b> (ya da <b>Tedarikçiler</b>) listesini açıp <b>Excel&apos;e aktar</b> ile indirin, dosyayı aşağıya yükleyin.
          VKN ya da aynı adla ERP&apos;de bulunan cariler işaretlenir; onlar yeniden açılmaz, yalnız boş bilgileri tamamlanır.
        </div>
        <BhPartyImport />
      </div>
    </>
  );
}
