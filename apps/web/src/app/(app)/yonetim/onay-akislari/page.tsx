import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { MOD_INFO } from "@/lib/users";
import { FlowEditor, type FlowData } from "./FlowEditor";

export const dynamic = "force-dynamic";

/** Onay akışı tasarımcısı: koda dokunmadan "şu tutarın üstü önce şefe, sonra muhasebeye" kuralları */
export default async function FlowsPage() {
  const s = await getSession();
  if (s.role !== "owner" && (s.modules.users ?? 0) < 3) redirect("/");
  const supabase = await createClient();
  const [{ data: fd, error }, { data: sd }, { data: ud }, { data: cd }] = await Promise.all([
    supabase.from("apr_flows").select("*").order("entity").order("priority", { ascending: false }).order("min_amount"),
    supabase.from("apr_flow_steps").select("flow_id, sort, approver_kind, user_id, module, level, label").order("sort"),
    supabase.rpc("users_overview"),
    supabase.from("fin_categories").select("id, name").eq("kind", "expense").eq("is_active", true).order("sort"),
  ]);
  const steps = (sd ?? []) as { flow_id: string; approver_kind: string; user_id: string | null; module: string | null; level: number | null; label: string | null }[];
  const flows: FlowData[] = ((fd ?? []) as Omit<FlowData, "steps">[]).map((f) => ({ ...f, steps: steps.filter((x) => x.flow_id === f.id).map((x) => ({ approver_kind: x.approver_kind, user_id: x.user_id ?? undefined, module: x.module ?? undefined, level: x.level ?? undefined, label: x.label ?? undefined })) }));
  const users = ((ud ?? []) as { user_id: string; display_name: string; role: string }[]).filter((u) => u.role !== "portal").map((u) => ({ id: u.user_id, name: u.display_name }));
  const modules = MOD_INFO.map((m) => ({ key: m.key, label: m.label, levels: m.levels }));

  return (
    <>
      <PageHeader title="Onay akışları" subtitle="Masraf ve satın alma için kurallar: tutar aralığına ve masraf türüne göre sıralı onay adımları. Uygun akış yoksa eski kural geçerli (masrafı yetkili onaylar, siparişte tutar sınırı)." actions={<Link href="/onaylar" className="text-sm font-semibold text-brand-700">Onay kutusu</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1200px]">
        {error && <Notice tone="bad">Supabase&apos;de 20261226000000_approvals.sql çalıştırılmalı.</Notice>}
        <Notice tone="info">Birden çok akış uyarsa önceliği yüksek olan, eşitse masraf türüne özel olan, o da eşitse alt sınırı yüksek olan uygulanır. &quot;Personelin yöneticisi&quot;: beyan sahibi personelin şubesi / bölümündeki şef (yoksa şirket sahibi). Kişi kendi talebini onaylayamaz.</Notice>
        {flows.map((f) => <Card key={f.id} title={`${f.entity === "expense_claim" ? "Masraf" : "Satın alma"} · ${f.name}`}><FlowEditor flow={f} users={users} categories={(cd ?? []) as { id: string; name: string }[]} modules={modules} /></Card>)}
        <Card title="Yeni akış"><FlowEditor users={users} categories={(cd ?? []) as { id: string; name: string }[]} modules={modules} /></Card>
      </div>
    </>
  );
}
