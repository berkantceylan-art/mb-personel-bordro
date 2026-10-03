import { PageHeader } from "@/components/ui";
import { getSession, todayIso } from "@/lib/session";
import { ImportForm } from "./ImportForm";

export default async function ImportPage() {
  await getSession();
  return (
    <>
      <PageHeader title="Excel'den Aktar" subtitle="Mevcut aylık maaş listenizi yükleyin; aynı isimli personel tekrar oluşturulmaz." />
      <div className="p-6 md:p-8">
        <ImportForm year={new Date().getFullYear()} today={todayIso()} />
      </div>
    </>
  );
}
