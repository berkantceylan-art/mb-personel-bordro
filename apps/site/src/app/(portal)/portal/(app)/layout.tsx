import Link from "next/link";
import { redirect } from "next/navigation";
import { ensurePortalAccount, portalSignOut } from "@/lib/portal-actions";
import { PORTAL_UI, portalContext, portalLocale } from "@/lib/portal";

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

  return (
    <div className="min-h-dvh bg-porcelain">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
          <Link href="/portal" className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={38} height={38} className="h-[38px] w-[38px]" />
            <span>
              <span className="display block text-lg font-semibold leading-tight">MB Dental</span>
              <span className="block text-xs text-white/60">{ui.title}</span>
            </span>
          </Link>
          {acc?.status === "active" && (
            <nav aria-label={ui.title} className="flex gap-1 text-sm">
              <Link href="/portal" className="rounded-lg px-3 py-2 text-white/85 hover:bg-white/10 hover:text-white">
                {ui.nav.cases}
              </Link>
              <Link href="/portal/vaka/yeni" className="rounded-lg bg-smile px-3 py-2 font-semibold text-navy hover:bg-white">
                + {ui.nav.newCase}
              </Link>
            </nav>
          )}
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden max-w-[16rem] truncate text-white/70 sm:inline">{acc?.company || acc?.name || ctx?.user.email}</span>
            <form action={portalSignOut}>
              <button type="submit" className="rounded-full border border-white/30 px-3 py-1.5 hover:border-white">
                {ui.nav.signOut}
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {!acc ? (
          <div className="rounded-3xl bg-white p-8">
            <h1 className="display text-2xl font-semibold text-navy">{ui.signup.title}</h1>
            <p className="mt-2 text-slate">{ui.signup.lead}</p>
            <Link href={`/portal/kayit?dil=${locale}`} className="mt-5 inline-block rounded-full bg-navy px-5 py-3 font-semibold text-white hover:bg-blue">
              {ui.signup.submit}
            </Link>
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
  );
}
