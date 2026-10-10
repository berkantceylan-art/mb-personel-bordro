import Link from "next/link";
import { redirect } from "next/navigation";
import { portalContext, portalLocale } from "@/lib/portal";
import { changeLoginEmail, changeLoginPassword, saveAccountProfile, saveMyProfile } from "@/lib/portal-profile-actions";
import { PROFILE_UI } from "@/lib/portal-profile-ui";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Member = { user_id: string; role: string; display_name: string | null; title: string | null; specialty: string | null; phone: string | null; chamber_no: string | null };

const card = "scroll-mt-24 rounded-3xl bg-white p-6 sm:p-8";
const label = "grid gap-1.5 text-sm font-semibold text-navy";
const input = "field font-normal";

function Section({ id, title, lead, children, ok, err, okText }: { id: string; title: string; lead: string; children: React.ReactNode; ok?: boolean; err?: string; okText: string }) {
  return (
    <section id={id} className={card}>
      <h2 className="display text-xl font-semibold text-navy">{title}</h2>
      <p className="mt-1 text-sm text-slate">{lead}</p>
      {ok && <p role="status" className="mt-4 rounded-xl bg-ok-bg px-4 py-2.5 text-sm font-semibold text-ok">{okText}</p>}
      {err && <p role="alert" className="mt-4 rounded-xl bg-bad-bg px-4 py-2.5 text-sm text-bad">{err}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** Hekim portalı profil sayfası */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ ok?: string; hata?: string }> }) {
  const ctx = await portalContext();
  if (!ctx?.account) redirect("/portal");
  const acc = ctx.account;
  const locale = await portalLocale(acc);
  const t = PROFILE_UI[locale];
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: members } = await supabase.from("portal_members").select("user_id, role, display_name, title, specialty, phone, chamber_no").eq("account_id", acc.id);
  const list = (members ?? []) as Member[];
  const me = list.find((m) => m.user_id === ctx.user.id);
  const admin = me?.role === "admin";
  const err = sp.hata ? t.errors[sp.hata] ?? t.errors.server : undefined;
  // hangi bölümde hata gösterilecek: adres çubuğundaki # ile aynı bölüm (sunucu bilemez) → giriş hataları giriş bölümünde, diğerleri kurumda
  const loginErr = sp.hata && ["email", "same", "wrong", "short", "mismatch", "weak", "exists", "rate"].includes(sp.hata) ? err : undefined;
  const otherErr = sp.hata && !loginErr ? err : undefined;

  const fields = [acc.company, acc.phone, acc.address, acc.city, acc.invoice_title ?? acc.company, acc.tax_office, acc.tax_no, me?.title, me?.specialty, me?.phone];
  const filled = Math.round((fields.filter((v) => v && String(v).trim()).length / fields.length) * 100);
  const dis = !admin;

  const AccountForm = ({ section, children }: { section: string; children: React.ReactNode }) => (
    <form action={saveAccountProfile} className="grid gap-4">
      <input type="hidden" name="section" value={section} />
      <fieldset disabled={dis} className="grid gap-4 disabled:opacity-70">{children}</fieldset>
      {admin ? (
        <div><button className="rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-blue">{t.save}</button></div>
      ) : (
        <p className="text-sm text-slate">{t.onlyAdmin}</p>
      )}
    </form>
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl font-semibold text-navy">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-slate">{t.lead}</p>
        </div>
        <div className="w-full max-w-xs rounded-2xl bg-white p-4 sm:w-64">
          <div className="flex justify-between text-sm"><span className="font-semibold text-navy">{t.completeness}</span><span className="num font-bold text-navy">%{filled}</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-porcelain"><div className="h-full rounded-full bg-gradient-to-r from-smile to-blue" style={{ width: `${filled}%` }} /></div>
        </div>
      </div>

      <nav aria-label={t.title} className="sticky top-0 z-10 -mx-4 mt-6 flex gap-2 overflow-x-auto bg-porcelain/95 px-4 py-2 text-sm backdrop-blur lg:top-0">
        {[["kisisel", t.me.title], ["kurum", t.org.title], ["adres", t.addr.title], ["fatura", t.inv.title], ["tercih", t.pref.title], ["giris", t.login.title], ["ekip", t.team.title]].map(([id, l]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full bg-white px-3.5 py-1.5 font-semibold text-navy hover:bg-navy hover:text-white">{l}</a>
        ))}
      </nav>

      <div className="mt-4 grid gap-6">
        <Section id="kisisel" title={t.me.title} lead={t.me.lead} ok={sp.ok === "kisisel"} okText={t.saved}>
          <form action={saveMyProfile} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
              <label className={label}>{t.me.titleLabel}
                <select name="title" defaultValue={me?.title ?? ""} className={input}>
                  <option value="">—</option>
                  {t.me.titles.map((x) => <option key={x}>{x}</option>)}
                </select>
              </label>
              <label className={label}>{t.me.name}<input name="display_name" defaultValue={me?.display_name ?? ""} maxLength={120} autoComplete="name" className={input} /></label>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className={label}>{t.me.specialty}
                <select name="specialty" defaultValue={me?.specialty ?? ""} className={input}>
                  <option value="">—</option>
                  {t.me.specialties.map((x) => <option key={x}>{x}</option>)}
                </select>
              </label>
              <label className={label}>{t.me.phone}<input name="phone" type="tel" defaultValue={me?.phone ?? ""} maxLength={40} autoComplete="tel" className={input} /></label>
              <label className={label}>{t.me.chamber} <span className="-mt-1 text-xs font-normal text-slate">{t.me.chamberHint}</span><input name="chamber_no" defaultValue={me?.chamber_no ?? ""} maxLength={40} className={input} /></label>
            </div>
            <div><button className="rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-blue">{t.save}</button></div>
          </form>
        </Section>

        <Section id="kurum" title={t.org.title} lead={t.org.lead} ok={sp.ok === "kurum"} err={otherErr} okText={t.saved}>
          <AccountForm section="kurum">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>{t.org.name}<input name="name" required minLength={2} maxLength={160} defaultValue={acc.name} className={input} /></label>
              <label className={label}>{t.org.company}<input name="company" maxLength={160} defaultValue={acc.company ?? ""} autoComplete="organization" className={input} /></label>
              <label className={label}>{t.org.phone}<input name="phone" type="tel" maxLength={40} defaultValue={acc.phone ?? ""} className={input} /></label>
              <label className={label}>{t.org.whatsapp}<input name="whatsapp" type="tel" maxLength={40} defaultValue={acc.whatsapp ?? ""} className={input} /></label>
              <label className={label}>{t.org.contactEmail}<input name="contact_email" type="email" maxLength={200} defaultValue={acc.contact_email ?? ""} placeholder={acc.email ?? ""} className={input} /></label>
              <label className={label}>{t.org.website}<input name="website" maxLength={200} defaultValue={acc.website ?? ""} placeholder="www.ornek.com" className={input} /></label>
              <label className={label}>{t.org.instagram}<input name="instagram" maxLength={100} defaultValue={acc.instagram ?? ""} placeholder="@kullaniciadi" className={input} /></label>
              <label className={label}>{t.org.hours}<input name="working_hours" maxLength={200} defaultValue={acc.working_hours ?? ""} placeholder={t.org.hoursPh} className={input} /></label>
            </div>
            <label className={label}>{t.org.about}<textarea name="about" rows={3} maxLength={1000} defaultValue={acc.about ?? ""} placeholder={t.org.aboutPh} className={input} /></label>
          </AccountForm>
        </Section>

        <Section id="adres" title={t.addr.title} lead={t.addr.lead} ok={sp.ok === "adres"} okText={t.saved}>
          <AccountForm section="adres">
            <label className={label}>{t.addr.address}<textarea name="address" rows={2} maxLength={300} defaultValue={acc.address ?? ""} autoComplete="street-address" className={input} /></label>
            <div className="grid gap-4 sm:grid-cols-4">
              <label className={label}>{t.addr.district}<input name="district" maxLength={80} defaultValue={acc.district ?? ""} className={input} /></label>
              <label className={label}>{t.addr.city}<input name="city" maxLength={80} defaultValue={acc.city ?? ""} autoComplete="address-level2" className={input} /></label>
              <label className={label}>{t.addr.postal}<input name="postal_code" maxLength={20} defaultValue={acc.postal_code ?? ""} autoComplete="postal-code" className={input} /></label>
              <label className={label}>{t.addr.country}<input name="country" maxLength={60} defaultValue={acc.country ?? "TR"} className={input} /></label>
            </div>
            <label className={label}>{t.addr.delivery} <span className="-mt-1 text-xs font-normal text-slate">{t.addr.deliveryHint}</span><textarea name="delivery_address" rows={2} maxLength={300} defaultValue={acc.delivery_address ?? ""} className={input} /></label>
            <label className={label}>{t.addr.deliveryNote}<input name="delivery_note" maxLength={300} defaultValue={acc.delivery_note ?? ""} placeholder={t.addr.deliveryNotePh} className={input} /></label>
          </AccountForm>
        </Section>

        <Section id="fatura" title={t.inv.title} lead={t.inv.lead} ok={sp.ok === "fatura"} okText={t.saved}>
          <AccountForm section="fatura">
            <input type="hidden" name="e_invoice_present" value="1" />
            <div className="grid gap-4 sm:grid-cols-3">
              <label className={`${label} sm:col-span-3`}>{t.inv.invoiceTitle}<input name="invoice_title" maxLength={200} defaultValue={acc.invoice_title ?? ""} placeholder={acc.company ?? acc.name} className={input} /></label>
              <label className={label}>{t.inv.taxOffice}<input name="tax_office" maxLength={80} defaultValue={acc.tax_office ?? ""} className={input} /></label>
              <label className={label}>{t.inv.taxNo}{t.inv.taxNoHint && <span className="-mt-1 text-xs font-normal text-slate">{t.inv.taxNoHint}</span>}<input name="tax_no" maxLength={20} inputMode="numeric" defaultValue={acc.tax_no ?? ""} className={`${input} num`} /></label>
              <label className="flex items-center gap-3 self-end rounded-xl border border-gypsum px-4 py-3 text-sm font-semibold text-navy">
                <input type="checkbox" name="e_invoice" defaultChecked={!!acc.e_invoice} className="h-4 w-4" /> {t.inv.eInvoice}
              </label>
            </div>
            <label className={label}>{t.inv.invoiceAddress} <span className="-mt-1 text-xs font-normal text-slate">{t.inv.invoiceAddressHint}</span><textarea name="invoice_address" rows={2} maxLength={300} defaultValue={acc.invoice_address ?? ""} className={input} /></label>
          </AccountForm>
        </Section>

        <Section id="tercih" title={t.pref.title} lead={t.pref.lead} ok={sp.ok === "tercih"} okText={t.saved}>
          <AccountForm section="tercih">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>{t.pref.shade}
                <select name="shade_system" defaultValue={acc.shade_system ?? ""} className={input}>
                  <option value="">—</option>
                  {t.pref.shades.map((x) => <option key={x}>{x}</option>)}
                </select>
              </label>
              <label className={label}>{t.pref.carrier}
                <select name="preferred_carrier" defaultValue={acc.preferred_carrier ?? ""} className={input}>
                  <option value="">—</option>
                  {Object.entries(t.pref.carriers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>
          </AccountForm>
        </Section>

        <Section id="giris" title={t.login.title} lead={t.login.lead} ok={sp.ok === "eposta" || sp.ok === "sifre"} err={loginErr} okText={sp.ok === "eposta" ? t.login.emailSent : t.login.passwordChanged}>
          <div className="grid gap-8 lg:grid-cols-2">
            <form action={changeLoginEmail} className="grid content-start gap-4">
              <p className="text-sm text-slate">{t.login.email}: <strong className="text-ink">{ctx.user.email}</strong></p>
              <label className={label}>{t.login.newEmail}<input name="email" type="email" required maxLength={200} autoComplete="email" className={input} /></label>
              <div><button className="rounded-full border border-navy px-6 py-3 font-semibold text-navy hover:bg-navy hover:text-white">{t.login.changeEmail}</button></div>
            </form>
            <form action={changeLoginPassword} className="grid content-start gap-4">
              <label className={label}>{t.login.current}<input name="current" type="password" required autoComplete="current-password" className={input} /></label>
              <label className={label}>{t.login.next}<input name="next" type="password" required minLength={8} autoComplete="new-password" className={input} /></label>
              <label className={label}>{t.login.repeat}<input name="repeat" type="password" required minLength={8} autoComplete="new-password" className={input} /></label>
              <div><button className="rounded-full border border-navy px-6 py-3 font-semibold text-navy hover:bg-navy hover:text-white">{t.login.changePassword}</button></div>
            </form>
          </div>
        </Section>

        <section id="ekip" className={card}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="display text-xl font-semibold text-navy">{t.team.title}</h2>
              <p className="mt-1 text-sm text-slate">{t.team.lead}</p>
            </div>
            <Link href="/portal/ekip" className="rounded-full bg-smile px-6 py-3 font-semibold text-navy hover:bg-navy hover:text-white">{t.team.open} →</Link>
          </div>
          <ul className="mt-5 flex flex-wrap gap-2">
            {list.map((m) => (
              <li key={m.user_id} className="rounded-full bg-porcelain px-3.5 py-1.5 text-sm">
                {[m.title, m.display_name].filter(Boolean).join(" ") || "—"}
                {m.specialty && <span className="text-slate"> · {m.specialty}</span>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
