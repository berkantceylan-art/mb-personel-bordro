import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { LEVEL_CLS, MOD_INFO, usersError } from "@/lib/users";
import { Avatar, TypeBadge, type TypeRow, type UserRow } from "../_ui";

export const dynamic = "force-dynamic";
const LV = ["—", "Görür", "Düzenler", "Yönetir"];

/** Yetki haritası: kim hangi modülde ne yapabilir — türlere göre gruplu, tek bakışta */
export default async function PermissionMap({ searchParams }: { searchParams: Promise<{ modul?: string }> }) {
  const s = await getSession();
  if (s.role !== "owner" && (s.modules.users ?? 0) < 1) redirect("/");
  const { modul } = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, { data: td }] = await Promise.all([supabase.rpc("users_overview"), supabase.rpc("user_types_list")]);
  const users = (data ?? []) as UserRow[];
  const types = (td ?? []) as TypeRow[];
  const groups: { key: string; name: string; color: string | null; rows: UserRow[] }[] = [
    { key: "owner", name: "Şirket sahibi", color: "#0F172A", rows: users.filter((u) => u.role === "owner") },
    ...types.map((t) => ({ key: t.id, name: t.name, color: t.color, rows: users.filter((u) => u.role !== "owner" && u.user_type_id === t.id) })),
    { key: "none", name: "Türsüz (eski rol)", color: null, rows: users.filter((u) => u.role !== "owner" && !u.user_type_id) },
  ].filter((g) => g.rows.length);
  const mod = MOD_INFO.find((m) => m.key === modul);

  return (
    <>
      <PageHeader title="Yetki haritası" subtitle="Satırlar kişiler, sütunlar modüller. Değiştirmek için kişiye ya da türe tıklayın." actions={<Link href="/yonetim" className="text-sm font-semibold text-brand-700">Kullanıcılar ve hesaplar</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1500px]">
        {error && <Notice tone="bad">{usersError(error.message)}</Notice>}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {LV.map((l, i) => <span key={l} className={`px-2 py-1 rounded-md font-semibold ${LEVEL_CLS[i]}`}>{i ? l : "Kullanmaz"}</span>)}
          <span className="text-muted">· Bir modül başlığına tıklayın: o modüle kimlerin eriştiğini görün.</span>
        </div>

        {mod && (
          <section className="rounded-[18px] border border-line bg-white p-5">
            <div className="flex items-baseline gap-2 mb-3"><h2 className="font-display text-lg font-bold">{mod.label}</h2><span className="text-sm text-muted">{mod.desc}</span><Link href="/yonetim/yetkiler" className="ml-auto text-sm font-semibold text-brand-700">Kapat</Link></div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[3, 2, 1].map((l) => (
                <div key={l} className="rounded-[12px] bg-[#F8FAFC] p-3">
                  <div className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${LEVEL_CLS[l]}`}>{mod.levels[l - 1]}</div>
                  <ul className="mt-2 flex flex-col gap-1 text-sm">{users.filter((u) => (u.levels[mod.key] ?? 0) === l).map((u) => <li key={u.user_id}><Link href={`/yonetim/kullanici/${u.user_id}`} className="hover:text-brand-700">{u.display_name}</Link></li>)}</ul>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="bg-white border border-line rounded-[18px] overflow-x-auto">
          <table className="w-full text-sm min-w-[1200px] border-separate border-spacing-0">
            <thead className="sticky top-0 bg-white">
              <tr className="text-xs text-muted">
                <th className="sticky left-0 bg-white text-left p-3 border-b border-line min-w-[230px]">Kişi</th>
                {MOD_INFO.map((m) => <th key={m.key} className={`p-2 border-b border-line font-semibold ${modul === m.key ? "text-brand-700" : ""}`}><Link href={`/yonetim/yetkiler?modul=${m.key}`} className="block leading-tight hover:text-brand-700" title={m.desc}>{m.label}</Link></th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.key}>
                  <tr>
                    <td colSpan={MOD_INFO.length + 1} className="sticky left-0 bg-[#F8FAFC] px-3 py-2 border-b border-line">
                      {g.key === "owner" || g.key === "none" ? <b className="text-xs uppercase tracking-wider text-muted">{g.name}</b> : <Link href={`/yonetim/turler/${g.key}`}><TypeBadge name={g.name} color={g.color} /></Link>}
                      <span className="ml-2 text-xs text-muted">{g.rows.length} kişi</span>
                    </td>
                  </tr>
                  {g.rows.map((u) => (
                    <tr key={u.user_id} className="hover:bg-[#FAFCFE]">
                      <td className="sticky left-0 bg-white p-2 border-b border-[#EEF2F6]">
                        <Link href={`/yonetim/kullanici/${u.user_id}`} className="flex items-center gap-2 hover:text-brand-700"><span className="scale-[.8]"><Avatar name={u.display_name} color={u.role === "owner" ? "#0F172A" : u.type_color} /></span><span className="font-semibold truncate">{u.display_name}</span></Link>
                      </td>
                      {MOD_INFO.map((m) => {
                        const v = u.levels[m.key] ?? 0;
                        const custom = u.user_type_id && u.explicit[m.key] !== undefined && u.explicit[m.key] !== (u.type_levels?.[m.key] ?? 0);
                        return <td key={m.key} className="p-1 border-b border-[#EEF2F6] text-center"><span className={`inline-block min-w-[70px] rounded-md px-1.5 py-1 text-[11px] font-semibold ${LEVEL_CLS[v]} ${custom ? "ring-2 ring-warn" : ""}`} title={custom ? "Kişiye özel" : undefined}>{LV[v]}</span></td>;
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
        <p className="text-xs text-muted">Turuncu çerçeve: türden farklı, kişiye özel ayar.</p>
      </div>
    </>
  );
}
