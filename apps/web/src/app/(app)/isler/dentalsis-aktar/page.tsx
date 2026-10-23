import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { dsisFiles } from "@/lib/dsis-actions";
import { DsisImporter } from "./DsisImporter";
import { DsisAutoSync } from "./DsisAutoSync";
import { DsisAudit } from "./DsisAudit";
import { dsisAuditState, dsisSyncStatus } from "@/lib/dsis-sync-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const metadata = { title: "Dentalsis'ten aktar" };

/** Dentalsis Plus 2026 iş kayıtlarını ERP'ye aktarma (tek seferlik) */
export default async function DentalsisImportPage() {
  const s = await getSession();
  if (s.role !== "owner") redirect("/isler");
  const [files, sync, audit] = await Promise.all([dsisFiles(), dsisSyncStatus(), dsisAuditState()]);
  return (
    <>
      <PageHeader title="Dentalsis'ten aktar" subtitle="Eski programdaki 2026 iş kayıtları, hekimler, ürünler ve tahsilatlar · tekrar çalıştırılırsa aynı kayıt ikinci kez oluşmaz" />
      <div className="p-4 md:p-6 max-w-[1000px] flex flex-col gap-4">
        <DsisAutoSync status={sync} />
        <DsisAudit state={audit} />
        <DsisImporter files={files} />
      </div>
    </>
  );
}
