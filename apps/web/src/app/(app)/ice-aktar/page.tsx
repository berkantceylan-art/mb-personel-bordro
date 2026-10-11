import { PageHeader } from "@/components/ui";
import { getSession, todayIso } from "@/lib/session";
import { ImportForm } from "./ImportForm";
import { SicilForm } from "./SicilForm";

export default async function ImportPage() {
  await getSession();
  return (
    <>
      <PageHeader title="Excel'den Aktar" subtitle="Personel sicil listesini veya aylık maaş listenizi yükleyin; aynı personel tekrar oluşturulmaz." />
      <div className="p-4 md:p-8 flex flex-col gap-6">
        <SicilForm />
        <div>
          <h2 className="font-display text-lg font-bold mb-3">Aylık maaş listesi</h2>
          <ImportForm year={new Date().getFullYear()} today={todayIso()} />
        </div>
      </div>
    </>
  );
}
