import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { FLOW_LABEL, LEVEL_CLS, MOD_GROUPS, MOD_INFO, ROLE_LABEL } from "@/lib/users";
import { assignUserType, removeUser, saveUserLevels, saveUserScope } from "@/lib/users-actions";
import { ResetPassword } from "../../AccountCreator";
import { Avatar, ModulePills, TypeBadge, ago, loginLabel, type TypeRow, type UserRow } from "../../_ui";

export const dynamic = "force-dynamic";
const LV = ["Yok", "Görür", "Düzenler", "Yönetir"];

/** Kullanıcı ayrıntısı: tür, kişiye özel yetki, kapsam, şifre, erişim */
export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  const lvl = s.role === "owner" ? 3 : (s.modules.users ?? 0);
  if (lvl < 1) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: ud }, { data: td }, { data: branches }, { data: departments }, { data: mb }, { data: md }] = await Promise.all([
    supabase.rpc("users_overview"),
    supabase.rpc("user_types_list"),
    supabase.from("branches").select("id, name").order("name"),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("membership_branches").select("branch_id").eq("user_id", id),
    supabase.from("membership_departments").select("department_id").eq("user_id", id),
  ]);
  const u = ((ud ?? []) as UserRow[]).find((x) => x.user_id === id);
  if (!u) notFound();
  const types = (td ?? []) as TypeRow[];
  const owner = u.role === "owner";
  const me = u.user_id === s.userId;
  const canEdit = !owner && !me && lvl >= 2;
  const myB = new Set((mb ?? []).map((x) => x.branch_id as string));
  const myD = new Set((md ?? []).map((x) => x.department_id as string));
  const tl = u.type_levels ?? {};
  const url = (await headers()).get("host") ?? "";

  return (
    <>
      <PageHeader title={u.display_name} subtitle={`${loginLabel(u.email)} · son giriş ${ago(u.last_sign_in_at)} · ${formatDate(u.created_at)} tarihinden beri`} actions={<Link href="/yonetim" className="text-sm font-semibold text-brand-700">← Kullanıcılar</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1100px]">
        <section className="rounded-[18px] border border-line bg-white p-5 flex flex-wrap items-center gap-4">
          <Avatar name={u.display_name} color={owner ? "#0F172A" : u.type_color} />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">{owner ? <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-semibold text-white">Şirket sahibi · tüm yetkiler</span> : <TypeBadge name={u.user_type} color={u.type_color} />}<span className="text-xs text-muted">{ROLE_LABEL[u.role]}</span></div>
            <div className="text-sm mt-1">{u.employee_id ? <Link href={`/personel/${u.employee_id}`} className="font-semibold text-brand-700">{u.employee_name}</Link> : <span className="text-muted">Personel kaydına bağlı değil</span>}{u.department ? <span className="text-muted"> · {u.department}</span> : null}{u.flow_role ? <span className="text-muted"> · kutu akışı: {FLOW_LABEL[u.flow_role]}</span> : null}</div>
          </div>
          {!owner && <ModulePills levels={u.levels} />}
        </section>

        {canEdit && (
          <section className="rounded-[18px] border border-line bg-white p-5 flex flex-col gap-3">
            <h2 className="font-display text-lg font-bold">Kullanıcı türü</h2>
            <form action={assignUserType} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <input type="hidden" name="user_id" value={u.user_id} />
              {types.map((t) => (
                <button key={t.id} name="type_id" value={t.id} className={`text-left rounded-[14px] border-2 p-3 transition ${u.user_type_id === t.id ? "border-current" : "border-line hover:border-[#B7C4D1]"}`} style={u.user_type_id === t.id ? { color: t.color } : undefined}>
                  <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} /><b className="text-ink">{t.name}</b>{u.user_type_id === t.id && <span className="ml-auto text-xs font-bold">✓ şu an</span>}</span>
                  {t.description && <span className="block text-xs text-muted mt-1 line-clamp-2">{t.description}</span>}
                </button>
              ))}
            </form>
            <p className="text-xs text-muted">Bir türe dokunmak onu hemen atar; kişinin menüsü ve yetkileri türden yazılır.</p>
          </section>
        )}

        <section className="rounded-[18px] border border-line bg-white overflow-hidden">
          <header className="px-5 py-4 border-b border-line flex flex-wrap items-baseline gap-2">
            <h2 className="font-display text-lg font-bold mr-auto">Modül yetkileri</h2>
            <span className="text-xs text-muted">{owner ? "Sahibin yetkileri değiştirilemez." : u.user_type ? "“Türden” seçili olanlar türle birlikte güncellenir. Farklı seçim kişiye özel istisnadır." : "Tür atanmamış: değerler eski rol varsayılanından gelir."}</span>
          </header>
          <form action={saveUserLevels}>
            <input type="hidden" name="user_id" value={u.user_id} />
            {MOD_GROUPS.map((g) => (
              <div key={g}>
                <div className="px-5 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted">{g}</div>
                {MOD_INFO.filter((m) => m.group === g).map((m) => {
                  const eff = u.levels[m.key] ?? 0;
                  const exp = u.explicit[m.key];
                  const custom = u.user_type_id ? exp !== undefined && exp !== (tl[m.key] ?? 0) : exp !== undefined;
                  return (
                    <div key={m.key} className="flex flex-wrap items-center gap-3 px-5 py-2.5 border-t border-[#F0F3F7]">
                      <span className="flex-1 min-w-48"><b className="text-sm">{m.label}</b><span className="block text-xs text-muted">{eff ? m.levels[eff - 1] : "Kullanmaz"}{custom && <span className="text-warn font-semibold"> · kişiye özel</span>}</span></span>
                      <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${LEVEL_CLS[eff]}`}>{LV[eff]}</span>
                      {canEdit && (
                        <select name={`lv_${m.key}`} defaultValue={custom ? String(exp) : "t"} aria-label={m.label} className="h-9 w-40 rounded-md border border-[#D5DEE8] bg-white px-2 text-xs">
                          <option value="t">{u.user_type ? `Türden (${LV[tl[m.key] ?? 0]})` : "Rol varsayılanı"}</option>
                          {LV.map((l, i) => <option key={l} value={i}>{l}{i ? ` — ${m.levels[i - 1]}` : ""}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {canEdit && <div className="px-5 py-4 border-t border-line"><PendingSubmit className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Yetkileri kaydet</PendingSubmit></div>}
          </form>
        </section>

        {(canEdit || (owner && me)) && (
          <section className="rounded-[18px] border border-line bg-white p-5 flex flex-col gap-3">
            <h2 className="font-display text-lg font-bold">Ad ve kapsam</h2>
            <form action={saveUserScope} className="flex flex-col gap-3">
              <input type="hidden" name="user_id" value={u.user_id} />
              <label className="flex flex-col gap-1 text-sm font-semibold max-w-sm">Görünen ad<input name="display_name" defaultValue={u.display_name} className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 font-normal" /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="all_branches" defaultChecked={u.all_branches} className="w-4 h-4" />Tüm şubeler</label>
              {(branches ?? []).length > 1 && <div className="flex flex-wrap gap-3 text-sm">{(branches ?? []).map((b) => <label key={b.id} className="flex items-center gap-1.5"><input type="checkbox" name="branch_id" value={b.id} defaultChecked={myB.has(b.id)} />{b.name}</label>)}</div>}
              {u.role === "branch_manager" && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold">Sorumlu olduğu bölümler <span className="font-normal text-muted">(hiçbiri seçili değilse şubesindeki tüm bölümler)</span></span>
                  <div className="flex flex-wrap gap-3 text-sm">{(departments ?? []).map((d) => <label key={d.id} className="flex items-center gap-1.5"><input type="checkbox" name="department_id" value={d.id} defaultChecked={myD.has(d.id)} />{d.name}</label>)}</div>
                </div>
              )}
              <div><PendingSubmit className="h-11 px-5 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Kaydet</PendingSubmit></div>
            </form>
          </section>
        )}

        {canEdit && (
          <section className="rounded-[18px] border border-line bg-white p-5 flex flex-col gap-4">
            <h2 className="font-display text-lg font-bold">Hesap</h2>
            <ResetPassword userId={u.user_id} url={url} />
            {lvl >= 3 && (
              <form action={removeUser} className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <input type="hidden" name="user_id" value={u.user_id} />
                <span className="text-sm text-muted flex-1">Erişimi kaldırınca kişi sisteme giremez; personel kaydı ve geçmişi silinmez.</span>
                <ConfirmSubmit label="Erişimi kaldır" question="Bu kullanıcının erişimi kaldırılsın mı?" className="h-10 px-4 rounded-[10px] border border-bad text-sm font-semibold text-bad" />
              </form>
            )}
          </section>
        )}
      </div>
    </>
  );
}
