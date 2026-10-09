import Link from "next/link";
import { redirect } from "next/navigation";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { LEVELS, LEVEL_STYLE } from "@/lib/performance";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { addSkill, saveGoal } from "../performans/actions";

const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm";

/** Beceri matrisi: kim hangi işi hangi seviyede yapıyor · tek kişiye bağlı işler · bölüm hedefleri */
export default async function SkillsMatrixPage({ searchParams }: { searchParams: Promise<{ bolum?: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: skills, error }, { data: emps }, { data: levels }, { data: depts }, { data: dGoals }] = await Promise.all([
    supabase.from("skills").select("id, company_id, name, category, sort").eq("active", true).order("sort"),
    supabase.from("employees").select("id, first_name, last_name, department_id, departments(name)").neq("status", "terminated").order("first_name"),
    supabase.from("employee_skills").select("employee_id, skill_id, level, target_level"),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("goals").select("id, title, progress, due_on, status, departments(name)").not("department_id", "is", null).neq("status", "cancelled").order("due_on"),
  ]);
  if (error) return (<><PageHeader title="Yetkinlik ve hedefler" /><div className="p-6"><Card><p className="text-sm">Bu modül için Supabase&apos;de <b>20261112000000_performance.sql</b> çalıştırılmalı.</p></Card></div></>);
  const sks = skills ?? [];
  const lv = new Map((levels ?? []).map((l) => [`${l.employee_id}|${l.skill_id}`, l]));
  const list = (emps ?? []).filter((e) => !sp.bolum || e.department_id === sp.bolum);
  // Tek kişiye bağlı beceriler: bağımsız (3+) yapabilen ≤ 1 kişi
  const risk = sks.map((k) => {
    const able = (emps ?? []).filter((e) => (lv.get(`${e.id}|${k.id}`)?.level ?? 0) >= 3);
    return { k, able };
  }).filter((x) => x.able.length <= 1 && (levels ?? []).some((l) => l.skill_id === x.k.id));
  return (
    <>
      <PageHeader title="Yetkinlik ve hedefler" subtitle="Beceri matrisi · tek kişiye bağlı işler · bölüm hedefleri" actions={<Link href="/performans" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Performans</Link>} />
      <div className="p-4 md:p-6 flex flex-col gap-4">
        {risk.length > 0 && (
          <Card title={`Tek kişiye bağlı işler · ${risk.length}`}>
            <ul className="text-sm divide-y divide-[#EEF2F6]">
              {risk.map(({ k, able }) => <li key={k.id} className="py-1.5 flex flex-wrap justify-between gap-2"><span><b>{k.name}</b> <span className="text-xs text-muted">{k.category}</span></span><span className={able.length ? "text-[#7A4F00]" : "text-bad font-semibold"}>{able.length ? `yalnız ${able[0]!.first_name} ${able[0]!.last_name} bağımsız yapabiliyor` : "bağımsız yapabilen kimse yok"}</span></li>)}
            </ul>
            <p className="text-xs text-muted">Bu kişi ayrılır, izne çıkar ya da raporlu olursa iş durur. Yedek yetiştirmek için hedef atayın.</p>
          </Card>
        )}
        <Card title="Beceri matrisi" action={
          <form className="flex gap-2"><select name="bolum" defaultValue={sp.bolum ?? ""} className={input} aria-label="Bölüm"><option value="">Tüm bölümler</option>{(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select><button className="h-10 px-3 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Süz</button></form>
        }>
          <div className="flex flex-wrap gap-2 text-xs">{LEVELS.map((l, i) => <span key={l} className={`rounded px-2 py-0.5 ${LEVEL_STYLE[i]}`}>{i} · {l}</span>)}</div>
          <div className="overflow-x-auto">
            <table className="text-xs border-separate border-spacing-0.5">
              <thead><tr><th className="sticky left-0 bg-white text-left p-1 min-w-[160px]">Personel</th>{sks.map((k) => <th key={k.id} className="p-1 font-semibold text-[#33475B] align-bottom"><span className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap">{k.name}</span></th>)}</tr></thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id}>
                    <td className="sticky left-0 bg-white p-1"><Link href={`/yetkinlik/${e.id}`} className="font-semibold text-brand-700">{e.first_name} {e.last_name}</Link><div className="text-[10px] text-muted">{(e.departments as unknown as { name: string } | null)?.name}</div></td>
                    {sks.map((k) => { const x = lv.get(`${e.id}|${k.id}`); return <td key={k.id} title={`${e.first_name} · ${k.name}: ${x ? LEVELS[x.level] : "girilmedi"}${x?.target_level != null ? ` → hedef ${LEVELS[x.target_level]}` : ""}`} className={`w-8 h-8 text-center rounded ${x ? LEVEL_STYLE[x.level] : "bg-white border border-dashed border-[#E1E8F0]"}`}>{x ? x.level : ""}{x?.target_level != null && x.target_level > x.level ? "↑" : ""}</td>; })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Kişiye tıklayıp seviyelerini ve hedeflerini girin. ↑ hedef seviye daha yüksek.</p>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Bölüm hedefleri">
            <ul className="text-sm divide-y divide-[#EEF2F6]">{(dGoals ?? []).map((g) => <li key={g.id} className="py-1.5 flex justify-between gap-2"><span>{g.title} <span className="text-xs text-muted">· {(g.departments as unknown as { name: string } | null)?.name}</span></span><span className="num">%{g.progress}</span></li>)}</ul>
            <form action={saveGoal} className="grid gap-2 sm:grid-cols-2 text-sm">
              <select name="department_id" required className={input} aria-label="Bölüm"><option value="">Bölüm seçin</option>{(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
              <input name="due_on" type="date" className={input} aria-label="Son tarih" />
              <input name="title" required placeholder="Örn. iade oranını %3'ün altına indirmek" className={`${input} sm:col-span-2`} />
              <PendingSubmit className="h-10 px-3 rounded-[10px] bg-brand-700 text-white font-semibold sm:col-span-2">Bölüm hedefi ekle</PendingSubmit>
            </form>
          </Card>
          {["owner", "hr"].includes(s.role) && (
            <Card title="Beceri listesi">
              <p className="text-xs text-muted">Diş laboratuvarı için varsayılan beceriler hazır; size özel becerileri ekleyin.</p>
              <form action={addSkill} className="flex flex-wrap gap-2 text-sm"><input name="name" required placeholder="Yeni beceri" className={`${input} flex-1`} /><input name="category" placeholder="Kategori" className={`${input} w-32`} /><PendingSubmit className="h-10 px-3 rounded-[10px] bg-brand-700 text-white font-semibold">Ekle</PendingSubmit></form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
