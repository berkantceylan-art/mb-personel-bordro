import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { bhCariList } from "@/lib/bh-cari-actions";
import { BhCariClient } from "./BhCariClient";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const metadata = { title: "Bizim Hesap carileri" };

/** Bizim Hesap'tan alınan cariler ve ekstreleri: seçerek ERP'ye aktarma */
export default async function Page() {
  const s = await getSession();
  if (!((s.modules.finance ?? 0) >= 2 || (s.modules.sales ?? 0) >= 2 || (s.modules.purchases ?? 0) >= 2)) redirect("/finans/cariler");
  const r = await bhCariList();
  return (
    <>
      <PageHeader title="Bizim Hesap carileri" subtitle="Bizim Hesap'taki müşteri ve tedarikçiler, kart bilgileri ve ekstreleriyle · aktarılacakları seçin"
        actions={<Link href="/finans/cariler" className="text-sm font-semibold text-brand-700">← Cari kartlar</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1300px]">
        {!r.ok && <p className="text-sm text-bad">{r.message}</p>}
        {r.ok && !r.items?.length && <p className="text-sm text-muted">Henüz Bizim Hesap dökümü yok.</p>}
        {r.items && r.items.length > 0 && <BhCariClient items={r.items} parties={r.parties ?? []} />}
      </div>
    </>
  );
}
