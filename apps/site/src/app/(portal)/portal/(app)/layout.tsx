import Link from "next/link";
import { redirect } from "next/navigation";
import { ensurePortalAccount, portalSignOut } from "@/lib/portal-actions";
import { PORTAL_UI, portalContext, portalLocale } from "@/lib/portal";
import { RailNav } from "@/components/RailNav";
import { PORTAL_RAIL, portalNav } from "@/lib/portal-nav";
import { TEAM_UI } from "@/lib/portal-team-ui";
import { joinPortalAccount, registerCurrentUser } from "@/lib/portal-team-actions";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PortalAppLayout({ children }: { children: React.ReactNode }) {
  let ctx = await portalContext();
  if (!ctx) redirect("/giris?sonra=/portal");
  // E-posta onayından sonra ilk giriş: kayıt bilgileriyle hesabı aç
  if (!ctx.account && (await ensurePortalAccount())) redirect("/portal");
  ctx = await portalContext();
  const locale = await portalLocale(ctx?.account);
  const ui = PORTAL_UI[locale];
  const acc = ctx?.account;
  // Okunmamış bildirim sayısı (son "Bildirimler" ziyaretinden sonra laboratuvardan gelenler)
  const joinError = !acc ? (await cookies()).get("portal-katil")?.value : undefined;
  let unread = 0;
  if (acc?.status === "active") {
    const seen = decodeURIComponent((await cookies()).get("portal-bildirim")?.value ?? "") || new Date(Date.now() - 14 * 86400000).toISOString();
    const supabase = await createClient();
    const [a, b, c] = await Promise.all([
      supabase.from("portal_case_events").select("id, portal_cases!inner(account_id)", { count: "exact", head: true }).eq("portal_cases.account_id", acc.id).eq("from_lab", true).gt("created_at", seen),
      supabase.from("shipment_events").select("id, shipments!inner(portal_account_id)", { count: "exact", head: true }).eq("shipments.portal_account_id", acc.id).neq("source", "portal").not("status", "is", null).gt("created_at", seen),
      supabase.from("cms_announcements").select("id", { count: "exact", head: true }).eq("audience", "portal").is("deleted_at", null).eq("is_active", true).gt("created_at", seen),
    ]);
    unread = (a.count ?? 0) + (b.count ?? 0) + (c.count ?? 0);
  }

  const signOutForm = (
    <>
      <p className="truncate px-1">{acc?.company || acc?.name || ctx?.user.email}</p>
      <div className="mt-1.5 flex gap-3 px-1">
        <Link href={`/${locale}`} className="hover:text-navy">{ui.nav.site} ↗</Link>
        <form action={portalSignOut}><button type="submit" className="hover:text-bad">{ui.nav.signOut}</button></form>
      </div>
    </>
  );

  return (
    <div className="min-h-dvh bg-porcelain lg:flex">
      {acc?.status === "active" ? (
        <div className="contents print:hidden">
          <RailNav
            groups={portalNav(locale, acc.type)}
            root="/portal"
            homeHref="/portal"
            badges={{ "/portal/bildirimler": unread }}
            storageKey="mb-portal-nav-v1"
            brand={`MB Dental · ${ui.title}`}
            labels={PORTAL_RAIL[locale]}
            cta={{ href: "/portal/vaka/yeni", label: ui.nav.newCase }}
            footer={signOutForm}
          />
        </div>
      ) : (
        <header className="bg-navy text-white print:hidden lg:fixed lg:inset-x-0 lg:top-0 lg:z-30">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:px-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={38} height={38} className="h-[38px] w-[38px]" />
            <span className="flex-1">
              <span className="display block text-lg font-semibold leading-tight">MB Dental</span>
              <span className="block text-xs text-white/60">{ui.title}</span>
            </span>
            <form action={portalSignOut}>
              <button type="submit" className="rounded-full border border-white/30 px-3 py-1.5 text-sm hover:border-white">{ui.nav.signOut}</button>
            </form>
          </div>
        </header>
      )}
      <div className="min-w-0 flex-1">
      <main className={`mx-auto max-w-6xl px-4 py-8 sm:px-6 ${acc?.status === "active" ? "" : "lg:pt-28"}`}>
        {!acc ? (
          <div className="rounded-3xl bg-white p-8">
            <h1 className="display text-2xl font-semibold text-navy">{ui.signup.title}</h1>
            <p className="mt-2 text-slate">{ui.signup.lead}</p>
            {joinError && (
              <p className="mt-4 rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">
                {joinError === "required" ? (locale === "tr" ? "Hesap türünü seçin ve adınızı yazın." : locale === "fr" ? "Choisissez le type de compte et saisissez votre nom." : "Choose an account type and enter your name.") : TEAM_UI[locale].errors[joinError] ?? TEAM_UI[locale].errors.server}
              </p>
            )}
            <form action={registerCurrentUser} className="mt-6 grid gap-4">
              <input type="hidden" name="language" value={locale} />
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-semibold text-navy">{ui.signup.type}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(Object.keys(ui.types) as (keyof typeof ui.types)[]).map((k, i) => (
                    <label key={k} className="flex cursor-pointer items-center gap-3 rounded-xl border border-gypsum bg-white px-4 py-3 text-sm has-[:checked]:border-navy has-[:checked]:bg-porcelain">
                      <input type="radio" name="type" value={k} defaultChecked={i === 0} required />
                      <span className="font-semibold text-ink">{ui.types[k]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-semibold text-navy">{ui.signup.name}<input name="name" required minLength={2} maxLength={160} autoComplete="name" className="field font-normal" /></label>
                <label className="grid gap-1.5 text-sm font-semibold text-navy">{ui.signup.company}<input name="company" maxLength={160} autoComplete="organization" className="field font-normal" /></label>
                <label className="grid gap-1.5 text-sm font-semibold text-navy">{ui.signup.country}<input name="country" maxLength={60} defaultValue="TR" className="field font-normal" /></label>
                <label className="grid gap-1.5 text-sm font-semibold text-navy">{ui.signup.city}<input name="city" maxLength={80} autoComplete="address-level2" className="field font-normal" /></label>
                <label className="grid gap-1.5 text-sm font-semibold text-navy">{ui.signup.phone}<input name="phone" type="tel" maxLength={40} autoComplete="tel" className="field font-normal" /></label>
              </div>
              <p className="text-xs text-slate">{ctx?.user.email}</p>
              <div>
                <button className="rounded-full bg-navy px-7 py-3 font-semibold text-white hover:bg-blue">{ui.signup.submit}</button>
              </div>
            </form>
            <form action={joinPortalAccount} className="mt-8 grid max-w-lg gap-3 border-t border-gypsum pt-6">
              <p className="font-semibold text-navy">{TEAM_UI[locale].joinTitle}</p>
              <p className="text-sm text-slate">{TEAM_UI[locale].joinLead}</p>
              <div className="flex flex-wrap gap-2">
                <input name="code" required maxLength={14} placeholder="ABCD234XYZ" className="field num flex-1 tracking-widest" />
                <input name="name" maxLength={120} placeholder={TEAM_UI[locale].inviteName} className="field flex-1" />
                <button className="rounded-full bg-smile px-5 py-3 font-semibold text-navy hover:bg-navy hover:text-white">{TEAM_UI[locale].join}</button>
              </div>
            </form>
          </div>
        ) : acc.status === "pending" ? (
          <div className="rounded-3xl bg-white p-8">
            <p className="text-sm font-semibold uppercase tracking-wider text-smile-ink">{ui.types[acc.type]}</p>
            <h1 className="display mt-2 text-3xl font-semibold text-navy">{ui.pending.title}</h1>
            <p className="mt-3 max-w-2xl text-slate">{ui.pending.text}</p>
          </div>
        ) : acc.status === "suspended" ? (
          <div className="rounded-3xl bg-white p-8">
            <h1 className="display text-3xl font-semibold text-navy">{ui.suspended.title}</h1>
            <p className="mt-3 text-slate">{ui.suspended.text}</p>
          </div>
        ) : (
          children
        )}
      </main>
      </div>
    </div>
  );
}
