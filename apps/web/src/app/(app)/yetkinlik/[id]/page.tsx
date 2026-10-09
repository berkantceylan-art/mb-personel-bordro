import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { LEVELS } from "@/lib/performance";
import { formatDate, getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { saveGoal, saveSkills } from "../../performans/actions";

const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm";

export default async function EmployeeSkillsPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: e }, { data: skills }, { data: levels }, { data: goals }] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name, departments(name)").eq("id", id).maybeSingle(),
    supabase.from("skills").select("id, name, category").eq("active", true).order("sort"),
    supabase.from("employee_skills").select("skill_id, level, target_level, assessed_at").eq("employee_id", id),
    supabase.from("goals").select("*").eq("employee_id", id).order("created_at", { ascending: false }),
  ]);
  if (!e) notFound();
  const lv = new Map((levels ?? []).map((l) => [l.skill_id, l]));
  const cats = [...new Set((skills ?? []).map((k) => k.category))];
  return (
    <>
      <PageHeader title={`${e.first_name} ${e.last_name}`} subtitle={`Beceriler ve hedefler · ${(e.departments as unknown as { name: string } | null)?.name ?? ""}`} actions={<Link href="/yetkinlik" className="text-sm font-semibold text-brand-700">← Matris</Link>} />
      <div className="p-4 md:p-6 grid gap-4 lg:grid-cols-[1.3fr_1fr] items-start max-w-[1200px]">
        <Card title="Beceri seviyeleri">
          <form action={saveSkills} className="flex flex-col gap-3">
            <input type="hidden" name="employee_id" value={id} />
            {cats.map((cat) => (
              <section key={cat} className="flex flex-col gap-1">
                <h3 className="text-xs font-bold uppercase tracking-wide text-brand-600">{cat}</h3>
                {(skills ?? []).filter((k) => k.category === cat).map((k) => {
                  const x = lv.get(k.id);
                  return (
                    <div key={k.id} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center py-1 border-b border-[#EEF2F6] text-sm">
                      <span>{k.name}{x ? <span className="block text-[11px] text-muted">{formatDate(x.assessed_at.slice(0, 10))}</span> : null}</span>
                      <select name={`lvl_${k.id}`} defaultValue={x ? String(x.level) : ""} className={input} aria-label={`${k.name} seviyesi`}><option value="">—</option>{LEVELS.map((l, i) => <option key={i} value={i}>{i} · {l}</option>)}</select>
                      <select name={`tgt_${k.id}`} defaultValue={x?.target_level != null ? String(x.target_level) : ""} className={input} aria-label={`${k.name} hedef seviye`}><option value="">Hedef —</option>{LEVELS.map((l, i) => <option key={i} value={i}>Hedef {i}</option>)}</select>
                    </div>
                  );
                })}
              </section>
            ))}
            <PendingSubmit className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold self-start">Kaydet</PendingSubmit>
          </form>
        </Card>
        <Card title="Hedefler">
          <ul className="flex flex-col gap-2">
            {(goals ?? []).map((g) => (
              <li key={g.id}>
                <details className="rounded-xl border border-line p-3">
                  <summary className="cursor-pointer list-none flex justify-between gap-2 text-sm"><span className={g.status === "done" ? "line-through text-muted" : "font-semibold"}>{g.title}</span><span className="num">%{g.progress}</span></summary>
                  <form action={saveGoal} className="grid gap-2 mt-2 text-sm">
                    <input type="hidden" name="id" value={g.id} /><input type="hidden" name="employee_id" value={id} />
                    <input name="title" defaultValue={g.title} className={input} aria-label="Başlık" />
                    <textarea name="description" rows={2} defaultValue={g.description ?? ""} className={`${input} h-auto py-2`} aria-label="Açıklama" />
                    <div className="grid grid-cols-3 gap-2">
                      <input name="due_on" type="date" defaultValue={g.due_on ?? ""} className={input} aria-label="Son tarih" />
                      <input name="progress" type="number" min={0} max={100} defaultValue={g.progress} className={input} aria-label="İlerleme %" />
                      <select name="status" defaultValue={g.status} className={input} aria-label="Durum"><option value="open">Açık</option><option value="done">Tamamlandı</option><option value="cancelled">İptal</option></select>
                    </div>
                    {g.last_note && <p className="text-xs text-muted">Personelin son notu: {g.last_note}</p>}
                    <PendingSubmit className="h-10 px-3 rounded-[10px] bg-brand-700 text-white font-semibold justify-self-start">Güncelle</PendingSubmit>
                  </form>
                </details>
              </li>
            ))}
          </ul>
          <form action={saveGoal} className="grid gap-2 text-sm border-t border-line pt-3">
            <input type="hidden" name="employee_id" value={id} />
            <input name="title" required placeholder="Yeni hedef (örn. zirkon tasarımda bağımsız çalışmak)" className={input} />
            <div className="grid grid-cols-2 gap-2"><input name="due_on" type="date" className={input} aria-label="Son tarih" /><PendingSubmit className="h-10 px-3 rounded-[10px] bg-brand-700 text-white font-semibold">Hedef ekle</PendingSubmit></div>
          </form>
        </Card>
      </div>
    </>
  );
}
