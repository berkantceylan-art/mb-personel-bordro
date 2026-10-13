import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { resetPlan } from "@/lib/reset-actions";
import { ResetWizard, type ModDef } from "./ResetWizard";

export const dynamic = "force-dynamic";

export default async function SystemResetPage() {
  const s = await getSession();
  if (s.role !== "owner") redirect("/yonetim");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sys_reset_modules");
  const plan = await resetPlan([]);
  const mods: ModDef[] = ((data ?? []) as Array<{ key: string; label: string; descr: string; sort: number }>).sort((a, b) => a.sort - b.sort).map((m) => ({ key: m.key, label: m.label, descr: m.descr }));
  return (
    <>
      <PageHeader title="Sistemi temizle" subtitle="Deneme kayıtlarını modül modül silin, canlı kullanıma temiz başlayın" />
      <div className="p-4 md:p-6 max-w-[980px]">
        {error || !plan.ok ? (
          <p className="text-sm rounded-[12px] px-4 py-3 bg-warn-bg text-warn">Supabase&apos;de 20270117000000_system_reset.sql çalıştırılmalı. {plan.message ?? ""}</p>
        ) : (
          <ResetWizard mods={mods} counts={plan.counts} company={s.companyName} />
        )}
      </div>
    </>
  );
}
