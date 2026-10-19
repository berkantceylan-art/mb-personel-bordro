import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { BhImport } from "./BhImport";

export const dynamic = "force-dynamic";

/** Dış programdan (Bizim Hesap) satış faturası aktarımı */
export default async function Page() {
  const s = await getSession();
  if ((s.modules.sales ?? 0) < 2) redirect("/satis");
  return (
    <>
      <PageHeader title="Satış faturası aktar" subtitle="Bizim Hesap satış raporundaki faturalar cari kartlara işlenir; işlere ve hekim carisine dokunulmaz" />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1100px]">
        <BhImport />
      </div>
    </>
  );
}
