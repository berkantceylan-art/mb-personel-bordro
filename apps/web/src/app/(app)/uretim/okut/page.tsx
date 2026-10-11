import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { FLOW_ROLE, FLOW_STAGE, since } from "@/lib/flow";
import { FlowScanner } from "./FlowScanner";

export const dynamic = "force-dynamic";

/** Kutu okut: personel telefonundan işi alır / bırakır; şef, kontrol ve pazarlama onaylar */
export default async function ScanPage() {
  const s = await getSession();
  const supabase = await createClient();
  const { data: list, error } = await supabase.rpc("prd_people_list");
  const people = ((list ?? []) as { employee_id: string; name: string; flow_role: string; me: boolean }[]).map((p) => ({ id: p.employee_id, name: p.name, role: p.flow_role, me: p.me }));
  const meRow = people.find((p) => p.me);
  const { data: myEmp } = meRow ? { data: null } : await supabase.from("employees").select("id, first_name, last_name").eq("user_id", s.userId).limit(1).maybeSingle();
  const me = meRow ?? (myEmp ? { id: myEmp.id as string, name: `${myEmp.first_name} ${myEmp.last_name}`, role: "technician", me: true } : null);
  const canPick = (s.modules.production ?? 0) >= 3 || s.logistics;
  if (!meRow && !canPick && (s.modules.production ?? 0) < 2) redirect("/");
  const { data: mine } = me ? await supabase.from("jobs").select("id, no, patient, due_date, flow_stage, holder_since, lab_customers(name)").eq("holder_employee_id", me.id).neq("status", "cancelled").order("holder_since").limit(100) : { data: [] };
  const held = (mine ?? []) as unknown as { id: string; no: number; patient: string | null; due_date: string | null; flow_stage: string; holder_since: string | null; lab_customers: { name: string } | null }[];
  const t = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Kutu okut" subtitle="Kutuyu aldığınızda okutun; işinizi bitirip bıraktığınızda tekrar okutun." actions={<Link href="/uretim/nerede" className="text-sm font-semibold text-brand-700">İş nerede?</Link>} />
      <div className="p-4 md:p-6 grid gap-5 lg:grid-cols-[1fr_380px] max-w-[1300px]">
        <div className="flex flex-col gap-3">
          {error && <Notice tone="bad">Supabase&apos;de 20261209000000_job_flow.sql çalıştırılmalı.</Notice>}
          {!meRow && <Notice>{me ? `Akışa eklenmemişsiniz; teknisyen olarak sayılırsınız. Rolünüzü yöneticiniz Üretim › Ekip sayfasından verir.` : "Hesabınız bir personele bağlı değil; yalnız başka kişi adına okutabilirsiniz."}</Notice>}
          <FlowScanner me={me ? { id: me.id, name: me.name, role: me.role } : null} people={people} canPickPerson={canPick} />
        </div>
        <section className="bg-white border border-line rounded-[16px] self-start">
          <h2 className="px-4 py-3 border-b border-line font-semibold">Elimdeki işler ({held.length}){me ? <span className="block text-xs font-normal text-muted">{me.name} · {FLOW_ROLE[me.role]}</span> : null}</h2>
          <ul className="divide-y divide-[#EEF2F6] text-sm">
            {held.map((j) => (
              <li key={j.id} className="px-4 py-2.5 flex items-center gap-3">
                <Link href={`/isler/${j.id}`} className="font-bold text-brand-700 w-20">#{j.no}</Link>
                <span className="flex-1 min-w-0 truncate">{j.patient ?? "—"}<span className="block text-xs text-muted truncate">{j.lab_customers?.name ?? ""} · {FLOW_STAGE[j.flow_stage]?.[0]}</span></span>
                <span className="text-right text-xs"><span className="block text-muted">{since(j.holder_since)}</span>{j.due_date && <span className={j.due_date < t ? "text-bad font-semibold" : "text-muted"}>{formatDate(j.due_date)}</span>}</span>
              </li>
            ))}
            {held.length === 0 && <li className="px-4 py-6 text-center text-muted">Elinizde iş yok.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}
