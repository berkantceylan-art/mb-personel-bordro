import { createPortalInvite, deletePortalInvite, removePortalMember } from "@/lib/portal-team-actions";
import { TEAM_UI } from "@/lib/portal-team-ui";
import { PORTAL_BUCKET, formatDate, portalContext, portalLocale } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";
import { LogoUploader } from "./LogoUploader";

export const metadata = { title: "Team" };

type Member = { user_id: string; role: string; display_name: string | null; email: string | null; created_at: string };
type Invite = { id: string; code: string; display_name: string | null; role: string; expires_at: string; used_at: string | null };

/** Klinik ekibi: üyeler, katılma kodları, logo */
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ kod?: string; hata?: string }> }) {
  const ctx = await portalContext();
  const acc = ctx!.account!;
  const locale = await portalLocale(acc);
  const tu = TEAM_UI[locale];
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: ms }, { data: inv }] = await Promise.all([
    supabase.from("portal_members").select("user_id, role, display_name, email, created_at").eq("account_id", acc.id).order("created_at"),
    supabase.from("portal_invites").select("id, code, display_name, role, expires_at, used_at").eq("account_id", acc.id).order("created_at", { ascending: false }).limit(50),
  ]);
  const members = (ms ?? []) as Member[];
  const me = members.find((m) => m.user_id === ctx!.user.id);
  const isAdmin = me?.role === "admin";
  const invites = ((inv ?? []) as Invite[]).filter((i) => !i.used_at && new Date(i.expires_at) > new Date());
  let logoUrl: string | null = null;
  const logoPath = (acc as { logo_path?: string | null }).logo_path;
  if (logoPath) logoUrl = (await supabase.storage.from(PORTAL_BUCKET).createSignedUrl(logoPath, 3600)).data?.signedUrl ?? null;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const card = "rounded-3xl bg-white p-6";

  return (
    <>
      <h1 className="display text-3xl font-semibold text-navy">{tu.teamTitle}</h1>
      <p className="mt-1 max-w-2xl text-slate">{tu.teamLead}</p>
      {sp.hata && <p className="mt-4 rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad">{tu.errors[sp.hata] ?? tu.errors.server}</p>}
      {sp.kod && (
        <div className="mt-4 rounded-2xl bg-ok-bg p-5 text-ok">
          <p className="text-sm">{tu.code}:</p>
          <p className="num mt-1 text-3xl font-bold tracking-[0.2em]">{sp.kod}</p>
          <p className="mt-2 text-sm">{tu.howTo}: {site}/portal/kayit?davet={sp.kod}</p>
        </div>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className={card}>
          <h2 className="display text-xl font-semibold text-navy">{tu.members}</h2>
          <ul className="mt-4 grid gap-2">
            {members.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 rounded-xl bg-porcelain px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{m.display_name ?? m.email ?? "—"}{m.user_id === ctx!.user.id && <span className="ml-1 text-xs text-slate">({tu.you})</span>}</p>
                  <p className="truncate text-xs text-slate">{m.email}</p>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold">{m.role === "admin" ? tu.admin : tu.member}</span>
                {isAdmin && m.user_id !== ctx!.user.id && (
                  <form action={removePortalMember}>
                    <input type="hidden" name="user" value={m.user_id} />
                    <button className="text-sm font-semibold text-bad">{tu.remove}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className={card}>
          <h2 className="display text-xl font-semibold text-navy">{tu.invite}</h2>
          {isAdmin ? (
            <>
              <p className="mt-1 text-sm text-slate">{tu.inviteLead}</p>
              <form action={createPortalInvite} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                <input name="name" placeholder={tu.inviteName} className="field" />
                <select name="role" defaultValue="member" className="field" aria-label={tu.inviteRole}>
                  <option value="member">{tu.member}</option>
                  <option value="admin">{tu.admin}</option>
                </select>
                <button className="rounded-full bg-navy px-5 py-3 font-semibold text-white hover:bg-blue">{tu.create}</button>
              </form>
              {invites.length > 0 && (
                <div className="mt-5">
                  <p className="text-sm font-semibold text-navy">{tu.codes}</p>
                  <ul className="mt-2 grid gap-2">
                    {invites.map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-porcelain px-4 py-2 text-sm">
                        <span className="num font-bold tracking-widest">{i.code}</span>
                        <span>{i.display_name ?? ""}</span>
                        <span className="text-xs text-slate">{tu.expires}: {formatDate(i.expires_at, locale)}</span>
                        <form action={deletePortalInvite} className="ml-auto"><input type="hidden" name="id" value={i.id} /><button className="text-xs font-semibold text-bad">×</button></form>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-slate">{tu.onlyAdmin}</p>
          )}
        </section>
        <section className={card}>
          <h2 className="display text-xl font-semibold text-navy">{tu.logo}</h2>
          <p className="mt-1 text-sm text-slate">{tu.logoLead}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logoUrl && <img src={logoUrl} alt="" className="mt-4 max-h-20 max-w-[220px] object-contain" />}
          <div className="mt-4">{isAdmin ? <LogoUploader accountId={acc.id} hasLogo={!!logoPath} labels={{ upload: tu.upload, remove: tu.removeLogo }} /> : <p className="text-sm text-slate">{tu.onlyAdmin}</p>}</div>
        </section>
      </div>
    </>
  );
}
