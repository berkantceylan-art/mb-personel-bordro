import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page, td, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { savePerson } from "@/lib/flow-actions";
import { FLOW_ROLE } from "@/lib/flow";

export const dynamic = "force-dynamic";

/** Akış ekibi: kim teknisyen, kim şef, kim kontrol sorumlusu, kim pazarlama (çıkış) */
export default async function TeamPage() {
  const s = await getSession();
  const can = (s.modules.production ?? 0) >= 3 || s.logistics;
  if ((s.modules.production ?? 0) < 1 && !s.logistics) redirect("/");
  const supabase = await createClient();
  const [{ data: emps }, { data: ppl, error }, { data: st }] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name, user_id, departments(name)").eq("status", "active").order("first_name"),
    supabase.from("prd_people").select("employee_id, flow_role, station_id, is_active"),
    supabase.from("prd_stations").select("id, name").eq("is_active", true).order("sort"),
  ]);
  const map = new Map(((ppl ?? []) as { employee_id: string; flow_role: string; station_id: string | null }[]).map((p) => [p.employee_id, p]));
  const list = ((emps ?? []) as unknown as { id: string; first_name: string; last_name: string; user_id: string | null; departments: { name: string } | null }[])
    .sort((a, b) => Number(map.has(b.id)) - Number(map.has(a.id)));
  const counts = Object.keys(FLOW_ROLE).map((k) => [k, [...map.values()].filter((p) => p.flow_role === k).length] as const);
  const sel = "h-9 rounded-md border border-[#D5DEE8] px-2 text-sm bg-white";
  return (
    <>
      <PageHeader title="Akış ekibi" subtitle="Kutuyu okutacak kişileri ve rollerini belirleyin. Akışa eklenen kişi telefonundan Kutu okut ekranını kullanır." actions={<Link href="/uretim/okut" className="text-sm font-semibold text-brand-700">Kutu okut</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">Supabase&apos;de 20261209000000_job_flow.sql çalıştırılmalı.</Notice>}
        <div className="flex flex-wrap gap-2 text-sm">{counts.map(([k, n]) => <span key={k} className="rounded-full border border-line bg-white px-3 py-1">{FLOW_ROLE[k]}: <b>{n}</b></span>)}</div>
        <Notice tone="info">Akış: <b>Teknisyen</b> kutuyu okutup alır, işini bitirince okutup bırakır → <b>Şef</b> okutup kontrol eder (onay / geri gönder) → <b>Kontrol sorumlusu</b> kalite onayı verir → <b>Pazarlama</b> okutup çıkış yapar, iş tutarı hekimin carisine o an işlenir. Personelin telefondan giriş yapabilmesi için hesabının (davet kodu) olması gerekir.</Notice>
        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-xs text-muted text-left"><th className={th}>Personel</th><th className={th}>Rol</th><th className={th}>İstasyon (teknisyen)</th><th className={th} /></tr></thead>
            <tbody>
              {list.map((e) => {
                const p = map.get(e.id);
                return (
                  <tr key={e.id} className={p ? "" : "opacity-70"}>
                    <td className={td}><b>{e.first_name} {e.last_name}</b><span className="block text-xs text-muted">{e.departments?.name ?? ""}{e.user_id ? "" : " · uygulama hesabı yok"}</span></td>
                    <td className={td} colSpan={3}>
                      {can ? (
                        <form action={savePerson} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="employee_id" value={e.id} />
                          <select name="flow_role" defaultValue={p?.flow_role ?? "none"} className={sel} aria-label="Rol"><option value="none">Akışta değil</option>{Object.entries(FLOW_ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                          <select name="station_id" defaultValue={p?.station_id ?? ""} className={sel} aria-label="İstasyon"><option value="">İstasyon yok</option>{(st ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                          <PendingSubmit className="text-sm font-semibold text-brand-700">Kaydet</PendingSubmit>
                        </form>
                      ) : <span>{p ? FLOW_ROLE[p.flow_role] : "—"}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <p className="text-xs text-muted">İstasyon seçilen teknisyen işi aldığında o istasyon adımı başlar, bıraktığında biter (malzeme reçetesi varsa stoktan düşer).</p>
      </div>
    </>
  );
}
