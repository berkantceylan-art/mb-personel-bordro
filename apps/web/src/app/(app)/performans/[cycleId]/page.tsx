import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { formatDate, getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { setCycleStatus } from "../actions";

type Row = { id: string; employee_id: string; self_submitted_at: string | null; mgr_submitted_at: string | null; shared_at: string | null; acknowledged_at: string | null; overall: number | null; raise_pct: number | null; employees: unknown };

/** Bir dönemin değerlendirme listesi (şef yalnız kendi bölümü) */
export default async function CyclePage({ params, searchParams }: { params: Promise<{ cycleId: string }>; searchParams: Promise<{ bolum?: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const { cycleId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: c }, { data }] = await Promise.all([
    supabase.from("review_cycles").select("*").eq("id", cycleId).maybeSingle(),
    supabase.from("reviews").select("id, employee_id, self_submitted_at, mgr_submitted_at, shared_at, acknowledged_at, overall, raise_pct, employees(first_name, last_name, departments(name))").eq("cycle_id", cycleId),
  ]);
  if (!c) notFound();
  const emp = (r: Row) => r.employees as { first_name: string; last_name: string; departments: { name: string } | null } | null;
  const all = ((data ?? []) as Row[]).sort((a, b) => (emp(a)?.departments?.name ?? "").localeCompare(emp(b)?.departments?.name ?? "", "tr") || (emp(a)?.first_name ?? "").localeCompare(emp(b)?.first_name ?? "", "tr"));
  const depts = [...new Set(all.map((r) => emp(r)?.departments?.name ?? "Bölümsüz"))];
  const rows = sp.bolum ? all.filter((r) => (emp(r)?.departments?.name ?? "Bölümsüz") === sp.bolum) : all;
  const dist = [1, 2, 3, 4, 5].map((n) => all.filter((r) => r.overall !== null && Math.round(Number(r.overall)) === n).length);
  const maxD = Math.max(1, ...dist);
  const status = (r: Row) => r.shared_at ? (r.acknowledged_at ? ["Personel okudu", "bg-[#E6F4EC] text-ok"] : ["Paylaşıldı", "bg-[#E7F1FB] text-brand-700"]) : r.mgr_submitted_at ? ["Şef değerlendirdi", "bg-[#FFF4E0] text-[#7A4F00]"] : r.self_submitted_at ? ["Öz değ. geldi", "bg-[#FFF4E0] text-[#7A4F00]"] : ["Bekliyor", "bg-[#EEF2F6] text-muted"];
  const hr = s.role !== "branch_manager";
  const raises = all.filter((r) => r.raise_pct !== null && Number(r.raise_pct) > 0);
  return (
    <>
      <PageHeader title={c.name} subtitle={`${formatDate(c.period_start)} – ${formatDate(c.period_end)} · ${all.length} kişi`} actions={
        <div className="flex gap-2 items-center flex-wrap">
          <Link href="/performans" className="text-sm font-semibold text-brand-700 mr-2">← Dönemler</Link>
          {hr && <form action={setCycleStatus}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value={c.status === "open" ? "closed" : "open"} /><PendingSubmit className="h-11 px-4 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">{c.status === "open" ? "Dönemi kapat" : "Yeniden aç"}</PendingSubmit></form>}
        </div>
      } />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1100px]">
        <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
          <Card title="Puan dağılımı">
            <div className="flex items-end gap-3 h-32" role="img" aria-label={dist.map((d, i) => `${i + 1} puan: ${d} kişi`).join(", ")}>
              {dist.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 justify-end h-full" title={`${i + 1}: ${d} kişi`}>
                  <span className="text-xs num">{d}</span>
                  <div className="w-full max-w-10 rounded-t bg-brand-700" style={{ height: `${(d / maxD) * 90}%`, minHeight: d ? 4 : 0 }} />
                  <span className="text-xs text-muted">{i + 1}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title={`Zam önerileri · ${raises.length}`} action={<Link href="/zamlar" className="text-sm font-semibold text-brand-700">Zamlar →</Link>}>
            {raises.length === 0 ? <p className="text-sm text-muted">Şef değerlendirmelerinde zam önerisi girildikçe burada listelenir.</p> : (
              <ul className="text-sm divide-y divide-[#EEF2F6]">{raises.sort((a, b) => Number(b.raise_pct) - Number(a.raise_pct)).slice(0, 12).map((r) => <li key={r.id} className="py-1.5 flex justify-between"><span>{emp(r)?.first_name} {emp(r)?.last_name}</span><span className="num">%{Number(r.raise_pct).toLocaleString("tr-TR")} · puan {Number(r.overall ?? 0).toLocaleString("tr-TR")}</span></li>)}</ul>
            )}
          </Card>
        </div>
        <Card title="Değerlendirmeler" action={
          <form className="flex gap-2"><select name="bolum" defaultValue={sp.bolum ?? ""} className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm" aria-label="Bölüm"><option value="">Tüm bölümler</option>{depts.map((d) => <option key={d}>{d}</option>)}</select><button className="h-10 px-3 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Süz</button></form>
        }>
          <ul className="divide-y divide-[#EEF2F6]">
            {rows.map((r) => {
              const [l, cls] = status(r);
              const e = emp(r);
              return (
                <li key={r.id}>
                  <Link href={`/performans/${cycleId}/${r.employee_id}`} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-semibold text-brand-700 min-w-[180px]">{e?.first_name} {e?.last_name}</span>
                    <span className="text-xs text-muted min-w-[120px]">{e?.departments?.name ?? "—"}</span>
                    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${cls}`}>{l}</span>
                    <span className="ml-auto num">{r.overall !== null ? <>puan <b>{Number(r.overall).toLocaleString("tr-TR")}</b></> : "—"}{r.raise_pct !== null ? ` · zam %${Number(r.raise_pct).toLocaleString("tr-TR")}` : ""}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}
