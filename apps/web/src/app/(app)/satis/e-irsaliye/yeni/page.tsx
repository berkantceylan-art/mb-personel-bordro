import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { page } from "@/components/erp";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { DespatchForm } from "../_parts/DespatchForm";

export const dynamic = "force-dynamic";

export default async function NewDespatch() {
  const s = await getSession();
  if ((s.modules.sales ?? 0) < 2 && !s.logistics) redirect("/");
  const supabase = await createClient();
  const { data } = await supabase.from("fin_parties").select("id, name, tax_no, is_edespatch").eq("is_active", true).order("name").limit(5000);
  const n = new Date(Date.now() + 3 * 3600000).toISOString();
  return (
    <>
      <PageHeader title="Yeni e-İrsaliye" subtitle="Sevk edilen malın elektronik irsaliyesi (alıcı e-İrsaliye mükellefi olmalı)" />
      <div className={page}>
        <DespatchForm parties={(data ?? []) as Array<{ id: string; name: string; tax_no: string | null; is_edespatch: boolean }>} now={{ date: n.slice(0, 10), time: n.slice(11, 16) }} />
      </div>
    </>
  );
}
