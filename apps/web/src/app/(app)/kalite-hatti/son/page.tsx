import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { lineData } from "../data";
import { ControlScreen } from "../ControlScreen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Son kontrol" };

export default async function Page() {
  const d = await lineData("qc");
  if (!d.allowed) redirect("/");
  return (
    <>
      <PageHeader title="Son kontrol" subtitle="İşi okutun, kontrol listesini işaretleyin; onaylayın ya da nedenle geri gönderin" actions={<Link href="/kalite-hatti" className="text-sm font-semibold text-brand-700">Kontrol hattı panosu</Link>} />
      <div className="p-4 md:p-6 max-w-[1300px]">
        {d.error && <Notice tone="bad">Supabase&apos;de 20261209000000_job_flow.sql çalıştırılmalı.</Notice>}
        <ControlScreen stage="qc" people={d.people} me={d.me} canPick={d.canPick} queue={d.queue} />
      </div>
    </>
  );
}
