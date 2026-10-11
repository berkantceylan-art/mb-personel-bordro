import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { IssueScreen } from "./IssueScreen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Personele teslim" };

/** Depo: personele okutarak malzeme teslimi, iki imzalı tutanak */
export default async function IssuePage() {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 2) redirect("/stok");
  const supabase = await createClient();
  const [{ data: people, error }, { data: wh }] = await Promise.all([supabase.rpc("stk_issue_people"), supabase.from("stk_warehouses").select("id, name, is_default").eq("is_active", true).order("name")]);
  return (
    <>
      <PageHeader title="Personele teslim (okut)" subtitle="Personeli seçin, ürünleri okutun; depo sorumlusu ve personel imzalar, stoktan düşer" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[900px]">
        {error && <Notice tone="bad">Supabase&apos;de 20270107000000_barcode.sql çalıştırılmalı.</Notice>}
        <IssueScreen people={(people ?? []) as { id: string; name: string; department: string | null; open_requests: number }[]} warehouses={(wh ?? []) as { id: string; name: string; is_default: boolean }[]} signer={s.email?.split("@")[0] ?? ""} />
      </div>
    </>
  );
}
