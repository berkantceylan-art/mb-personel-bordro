import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { lineData } from "../data";
import { PackScreen } from "../PackScreen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paketleme / çıkış" };

export default async function PackPage() {
  const d = await lineData("dispatch");
  if (!d.allowed) redirect("/");
  const supabase = await createClient();
  const { data: pk, error } = await supabase.rpc("prd_pack_list");
  return (
    <>
      <PageHeader title="Paketleme / çıkış" subtitle={`Son kontrolden geçen işleri okutup paketleyin · çıkışa hazır ${d.queue.length} iş`} actions={<Link href="/kalite-hatti" className="text-sm font-semibold text-brand-700">Kontrol hattı panosu</Link>} />
      <div className="p-4 md:p-6 max-w-[1300px]">
        {error && <Notice tone="bad">Supabase&apos;de 20270108000000_qc_line.sql çalıştırılmalı.</Notice>}
        <PackScreen people={d.people} me={d.me} canPick={d.canPick} packages={(pk ?? []) as { id: string; no: string; status: string; exited: boolean; customer: string | null; packer: string | null; packer_id: string | null; jobs: number; closed_at: string | null }[]} />
      </div>
    </>
  );
}
