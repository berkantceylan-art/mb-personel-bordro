import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { formatInviteCode } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { FLOW_LABEL, ROLE_LABEL, usersError } from "@/lib/users";
import { assignUserType, restoreUserTypes } from "@/lib/users-actions";
import { deleteInvite } from "./actions";
import { AccountCreator } from "./AccountCreator";
import { AdminTabs, Avatar, ModulePills, TypeBadge, ago, loginLabel, type TypeRow, type UserRow } from "./_ui";

export const dynamic = "force-dynamic";

/** Yönetim paneli: kullanıcılar, tek ekrandan hesap açma, kullanıcı türleri, davet kodları */
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ sekme?: string; ara?: string; tur?: string }> }) {
  const s = await getSession();
  const lvl = s.role === "owner" ? 3 : (s.modules.users ?? 0);
  if (lvl < 1) redirect("/");
  const sp = await searchParams;
  const tab = ["kullanicilar", "hesap-ac", "turler", "davetler"].includes(sp.sekme ?? "") ? sp.sekme! : "kullanicilar";
  const supabase = await createClient();
  const [{ data: ud, error: uErr }, { data: td }, { data: ed }, { data: inv }] = await Promise.all([
    supabase.rpc("users_overview"),
    supabase.rpc("user_types_list"),
    lvl >= 2 ? supabase.rpc("users_without_account") : Promise.resolve({ data: [] }),
    supabase.from("invites").select("id, code, role, display_name, login_email, used_at, expires_at, created_at, user_type_id").is("used_at", null).order("created_at", { ascending: false }).limit(300),
  ]);
  const users = (ud ?? []) as UserRow[];
  const types = (td ?? []) as TypeRow[];
  const noAccount = (ed ?? []) as { employee_id: string; name: string; card_no: string | null; department: string | null; email: string | null; open_invite: string | null }[];
  const invites = ((inv ?? []) as { id: string; code: string; role: string; display_name: string | null; login_email: string; expires_at: string; created_at: string; user_type_id: string | null }[]).filter((i) => new Date(i.expires_at) > new Date());
  const typeName = new Map(types.map((t) => [t.id, t]));
  const stale = users.filter((u) => !u.last_sign_in_at || Date.now() - new Date(u.last_sign_in_at).getTime() > 30 * 86400000).length;
  const q = (sp.ara ?? "").trim().toLocaleLowerCase("tr");
  const shown = users.filter((u) => (!q || `${u.display_name} ${u.email ?? ""} ${u.department ?? ""} ${u.user_type ?? ""}`.toLocaleLowerCase("tr").includes(q)) && (!sp.tur || (sp.tur === "yok" ? !u.user_type_id && u.role !== "owner" : u.user_type_id === sp.tur)));
  const h = await headers();
  const url = h.get("host") ?? "";
  const keyReady = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const defaultType = types.find((t) => t.name.startsWith("Personel"))?.id ?? types[0]?.id ?? "";

  return (
    <>
      <PageHeader title="Kullanıcılar ve hesaplar" subtitle="Kim sisteme girebilir, hangi modülleri kullanır. Türü değiştirin, yetki anında güncellensin."
        actions={<span className="flex flex-wrap gap-4 text-sm font-semibold">{lvl >= 3 && <Link href="/yonetim/kontrol" className="text-brand-700">🛰 Kontrol Merkezi</Link>}<Link href="/yonetim/yetkiler" className="text-brand-700">Yetki haritası</Link><Link href="/yonetim/sirket" className="text-brand-700">Şirket ayarları</Link>{lvl >= 2 && <Link href="/yonetim/hareketler" className="text-brand-700">İşlem geçmişi</Link>}</span>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {uErr && <Notice tone="bad">{usersError(uErr.message)}</Notice>}

        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[
            ["Kullanıcı", users.length, `${types.length} kullanıcı türü`, "/yonetim?sekme=kullanicilar", ""],
            ["Hesabı olmayan personel", noAccount.length, noAccount.length ? "Tek tuşla hesap açın →" : "Herkesin hesabı var", "/yonetim?sekme=hesap-ac", noAccount.length ? "warn" : ""],
            ["Bekleyen davet", invites.length, "kullanılmamış kod", "/yonetim?sekme=davetler", ""],
            ["30 gündür girmeyen", stale, "ya da hiç girmedi", "/yonetim?sekme=kullanicilar", ""],
          ].map(([l, v, sub, href, tone]) => (
            <Link key={String(l)} href={String(href)} className={`rounded-[16px] border p-4 transition hover:border-brand-600 ${tone === "warn" ? "border-[#F5D9A8] bg-[#FFF9EE]" : "border-line bg-white"}`}>
              <div className="text-xs font-semibold text-muted">{l}</div>
              <div className="font-display text-3xl font-bold mt-1">{v}</div>
              <div className={`text-xs ${tone === "warn" ? "text-warn font-semibold" : "text-muted"}`}>{sub}</div>
            </Link>
          ))}
        </div>

        <AdminTabs active={tab} counts={{ "hesap-ac": noAccount.length, davetler: invites.length }} />

        {tab === "kullanicilar" && (
          <>
            <form className="flex flex-wrap gap-2">
              <input type="hidden" name="sekme" value="kullanicilar" />
              <input name="ara" defaultValue={sp.ara} placeholder="Ad, kullanıcı adı, bölüm ara…" className="h-11 flex-1 min-w-56 rounded-[12px] border border-[#D5DEE8] bg-white px-4" />
              {sp.tur && <input type="hidden" name="tur" value={sp.tur} />}
              <button className="h-11 px-4 rounded-[12px] border border-[#D5DEE8] bg-white font-semibold">Ara</button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              <Link href="/yonetim?sekme=kullanicilar" className={`rounded-full px-3 py-1 text-xs font-semibold border ${!sp.tur ? "bg-ink text-white border-ink" : "bg-white border-line"}`}>Hepsi {users.length}</Link>
              {types.filter((t) => t.members).map((t) => (
                <Link key={t.id} href={`/yonetim?sekme=kullanicilar&tur=${t.id}`} className={`rounded-full px-3 py-1 text-xs font-semibold border ${sp.tur === t.id ? "text-white border-transparent" : "bg-white border-line"}`} style={sp.tur === t.id ? { background: t.color } : undefined}>{t.name} {t.members}</Link>
              ))}
              {users.some((u) => !u.user_type_id && u.role !== "owner") && <Link href="/yonetim?sekme=kullanicilar&tur=yok" className={`rounded-full px-3 py-1 text-xs font-semibold border border-dashed ${sp.tur === "yok" ? "bg-ink text-white" : "bg-white border-[#C5D0DB]"}`}>Türsüz {users.filter((u) => !u.user_type_id && u.role !== "owner").length}</Link>}
            </div>
            <section className="bg-white border border-line rounded-[18px] divide-y divide-[#EEF2F6]">
              {shown.map((u) => {
                const owner = u.role === "owner";
                const me = u.user_id === s.userId;
                return (
                  <div key={u.user_id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                    <Link href={`/yonetim/kullanici/${u.user_id}`} className="flex items-center gap-3 min-w-0 lg:w-[300px] shrink-0 group">
                      <Avatar name={u.display_name} color={owner ? "#0F172A" : u.type_color} />
                      <span className="min-w-0">
                        <span className="block font-semibold truncate group-hover:text-brand-700">{u.display_name}{me && <span className="text-xs font-normal text-muted"> (siz)</span>}</span>
                        <span className="block text-xs text-muted truncate">{loginLabel(u.email)} · {ago(u.last_sign_in_at)}</span>
                      </span>
                    </Link>
                    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {owner ? <span className="inline-flex rounded-full bg-ink px-2.5 py-0.5 text-xs font-semibold text-white">Şirket sahibi · tüm yetkiler</span> : <TypeBadge name={u.user_type} color={u.type_color} />}
                        {u.flow_role && <span className="text-xs text-muted">· {FLOW_LABEL[u.flow_role]}</span>}
                        {u.department && <span className="text-xs text-muted">· {u.department}</span>}
                        {!owner && u.user_type_id && Object.keys(u.explicit).some((k) => (u.type_levels?.[k] ?? 0) !== u.explicit[k]) && <span className="text-[11px] font-semibold text-warn">· kişiye özel ayar</span>}
                      </span>
                      {!owner && <ModulePills levels={u.levels} />}
                    </div>
                    {!owner && !me && lvl >= 2 && (
                      <form action={assignUserType} className="flex gap-1.5 shrink-0">
                        <input type="hidden" name="user_id" value={u.user_id} />
                        <select name="type_id" defaultValue={u.user_type_id ?? ""} aria-label="Kullanıcı türü" className="h-10 w-48 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm">
                          {!u.user_type_id && <option value="">Tür seçin…</option>}
                          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        <PendingSubmit className="h-10 px-3 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Uygula</PendingSubmit>
                      </form>
                    )}
                    <Link href={`/yonetim/kullanici/${u.user_id}`} className="text-sm font-semibold text-brand-700 shrink-0">Ayrıntı →</Link>
                  </div>
                );
              })}
              {shown.length === 0 && <p className="p-8 text-center text-muted">Kullanıcı yok.</p>}
            </section>
            {users.some((u) => !u.user_type_id && u.role !== "owner") && <p className="text-xs text-muted">Türsüz kullanıcılar eski rol sistemindeki yetkileriyle çalışmaya devam eder ({[...new Set(users.filter((u) => !u.user_type_id && u.role !== "owner").map((u) => ROLE_LABEL[u.role]))].join(", ")}). Bir tür atadığınızda yetkileri türden gelir.</p>}
          </>
        )}

        {tab === "hesap-ac" && (lvl < 2 ? <Notice>Hesap açmak için Kullanıcı yönetiminde “Hesap açar” yetkisi gerekir.</Notice> : types.length === 0 ? <Notice>Önce bir kullanıcı türü oluşturun.</Notice> : (
          <AccountCreator employees={noAccount} types={types.map((t) => ({ id: t.id, name: t.name, color: t.color, description: t.description }))} defaultType={defaultType} url={url} keyReady={keyReady} />
        ))}

        {tab === "turler" && (
          <>
            <p className="text-sm text-muted max-w-3xl">Her tür, bir görevin hangi modülleri hangi seviyede kullanacağını tanımlar. Türü düzenlediğinizde o türdeki herkesin yetkisi birlikte güncellenir. Bir kişiye istisna gerekirse kullanıcının sayfasından kişiye özel ayar yapılır.</p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {types.map((t) => (
                <Link key={t.id} href={`/yonetim/turler/${t.id}`} className="group rounded-[18px] border border-line bg-white overflow-hidden flex flex-col hover:shadow-md transition">
                  <div className="h-1.5" style={{ background: t.color }} />
                  <div className="p-4 flex flex-col gap-2 flex-1">
                    <div className="flex items-start gap-2">
                      <b className="font-display text-lg leading-tight flex-1 group-hover:text-brand-700">{t.name}</b>
                      <span className="rounded-full bg-[#EEF2F6] px-2 py-0.5 text-xs font-semibold">{t.members} kişi</span>
                    </div>
                    {t.description && <p className="text-xs text-muted">{t.description}</p>}
                    <ModulePills levels={t.levels} max={8} />
                    <span className="mt-auto pt-2 text-[11px] text-muted">{ROLE_LABEL[t.base_role]}{t.flow_role ? ` · kutu akışı: ${FLOW_LABEL[t.flow_role]}` : ""}{t.scoped ? " · kendi bölümü" : ""}</span>
                  </div>
                </Link>
              ))}
              {lvl >= 3 && (
                <Link href="/yonetim/turler/yeni" className="rounded-[18px] border-2 border-dashed border-[#C5D0DB] grid place-items-center p-8 text-center hover:border-brand-600 hover:bg-[#F7FAFD]">
                  <span><span className="block text-3xl text-brand-700">+</span><b className="block">Yeni kullanıcı türü</b><span className="text-xs text-muted">ör. Satış temsilcisi, Kurye, Mali müşavir</span></span>
                </Link>
              )}
            </div>
            {lvl >= 3 && <form action={restoreUserTypes}><button className="text-xs font-semibold text-brand-700">Eksik hazır türleri geri ekle</button></form>}
          </>
        )}

        {tab === "davetler" && (
          <section className="bg-white border border-line rounded-[18px] overflow-x-auto">
            <div className="flex flex-wrap items-center gap-3 p-4 border-b border-line">
              <p className="text-sm text-muted flex-1">Davet kodu verilen kişi uygulamada “Hesap oluştur” deyip kodu ve kendi şifresini girer. Kodlar 30 gün geçerlidir.</p>
              {invites.length > 0 && <Link href="/yazdir/davetler" className="text-sm font-semibold text-brand-700">Listeyi yazdır</Link>}
            </div>
            <table className="w-full text-sm min-w-[760px]">
              <thead><tr className="text-left text-xs text-muted"><th className="p-3">Kod</th><th className="p-3">Kişi</th><th className="p-3">Tür</th><th className="p-3">Kullanıcı adı</th><th className="p-3">Son gün</th><th className="p-3" /></tr></thead>
              <tbody>
                {invites.map((i) => {
                  const t = i.user_type_id ? typeName.get(i.user_type_id) : null;
                  return (
                    <tr key={i.id} className="border-t border-[#EEF2F6]">
                      <td className="p-3 font-mono font-bold tracking-widest">{formatInviteCode(i.code)}</td>
                      <td className="p-3">{i.display_name ?? "—"}</td>
                      <td className="p-3">{t ? <TypeBadge name={t.name} color={t.color} /> : <span className="text-xs text-muted">{ROLE_LABEL[i.role]}</span>}</td>
                      <td className="p-3 text-xs">{loginLabel(i.login_email)}</td>
                      <td className="p-3 text-xs">{formatDate(i.expires_at)}</td>
                      <td className="p-3 text-right">{lvl >= 2 && <form action={deleteInvite}><input type="hidden" name="id" value={i.id} /><ConfirmSubmit label="Sil" /></form>}</td>
                    </tr>
                  );
                })}
                {invites.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted">Bekleyen davet yok. Yeni hesaplar <Link href="/yonetim?sekme=hesap-ac" className="font-semibold text-brand-700">Hesap aç</Link> sekmesinden açılır.</td></tr>}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </>
  );
}
