import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession, todayIso } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Doğum günleri" };

const AY = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** Bugün ve önümüzdeki 30 günün doğum günleri */
export default async function BirthdaysPage() {
  await getSession();
  const sb = await createClient();
  const today = todayIso();
  const [{ data: emps }, { data: privs }] = await Promise.all([
    sb.from("employees").select("id, first_name, last_name, position_title, departments(name)").eq("status", "active"),
    sb.from("employee_private").select("employee_id, birth_date").not("birth_date", "is", null),
  ]);
  const byId = new Map((emps ?? []).map((e) => [e.id as string, e]));
  const t0 = Date.parse(`${today}T00:00:00Z`);
  const rows = (privs ?? [])
    .map((p) => {
      const e = byId.get(p.employee_id as string);
      if (!e) return null;
      const b = String(p.birth_date);
      const y = Number(today.slice(0, 4));
      let next = Date.parse(`${y}-${b.slice(5, 10)}T00:00:00Z`);
      if (Number.isNaN(next)) next = Date.parse(`${y}-03-01T00:00:00Z`); // 29 Şubat
      if (next < t0) next = Date.parse(`${y + 1}-${b.slice(5, 10)}T00:00:00Z`) || Date.parse(`${y + 1}-03-01T00:00:00Z`);
      const inDays = Math.round((next - t0) / 86400000);
      return { id: e.id as string, name: `${e.first_name} ${e.last_name}`, dept: (e.departments as unknown as { name: string } | null)?.name ?? "", title: (e.position_title as string | null) ?? "", day: Number(b.slice(8, 10)), month: Number(b.slice(5, 7)), inDays };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.inDays <= 30)
    .sort((a, b) => a.inDays - b.inDays);
  const todayRows = rows.filter((r) => r.inDays === 0);
  const later = rows.filter((r) => r.inDays > 0);
  const noDate = (emps ?? []).length - (privs ?? []).filter((p) => byId.has(p.employee_id as string)).length;

  return (
    <>
      <PageHeader title="Doğum günleri" subtitle="Bugün ve önümüzdeki 30 gün" actions={<Link href="/personel" className="text-sm font-semibold text-brand-700">← Personel</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-3xl">
        <section className="rounded-2xl p-5 bg-gradient-to-br from-[#FFF1F5] to-[#FFF8E6] border border-[#F6D5E0]">
          <h2 className="font-display font-bold text-lg text-[#9B2C5A]">🎂 Bugün</h2>
          {todayRows.length ? (
            <ul className="mt-3 flex flex-col gap-2">
              {todayRows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 bg-white/80 rounded-xl px-4 py-3">
                  <span className="w-10 h-10 rounded-full bg-[#E5487D] text-white grid place-items-center font-bold">{r.name.slice(0, 1)}</span>
                  <span className="flex-1"><Link href={`/personel/${r.id}`} className="font-semibold text-brand-800">{r.name}</Link><span className="block text-xs text-muted">{[r.dept, r.title].filter(Boolean).join(" · ")}</span></span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-muted">Bugün doğum günü olan yok.</p>}
        </section>
        <section className="bg-white border border-line rounded-2xl">
          <h2 className="font-display font-semibold text-brand-800 px-5 pt-4 pb-2">Yaklaşanlar</h2>
          <ul>
            {later.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-2.5 border-t border-[#EEF2F6] text-sm">
                <span className="num w-20 text-muted">{r.day} {AY[r.month - 1]}</span>
                <span className="flex-1"><Link href={`/personel/${r.id}`} className="font-semibold text-brand-800">{r.name}</Link>{r.dept && <span className="text-xs text-muted"> · {r.dept}</span>}</span>
                <span className="text-xs font-semibold text-brand-700">{r.inDays === 1 ? "yarın" : `${r.inDays} gün sonra`}</span>
              </li>
            ))}
            {!later.length && <li className="px-5 py-4 text-sm text-muted border-t border-[#EEF2F6]">30 gün içinde doğum günü yok.</li>}
          </ul>
        </section>
        {noDate > 0 && <p className="text-xs text-muted">{noDate} personelin doğum tarihi girilmemiş; personel kartı › Düzenle › Kimlik bölümünden eklenebilir.</p>}
      </div>
    </>
  );
}
