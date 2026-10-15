import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, btnPrimary, btnSecondary, inputCls, page, td, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { PACKAGE_PARTS } from "@/lib/gl-package";
import { glPackageEmail, glPackageSettings } from "@/lib/package-actions";

export const dynamic = "force-dynamic";

type Send = { id: string; period: string; kind: string; to_emails: string | null; files: string[]; size: number | null; error: string | null; sent_at: string };

/** Mali müşavir paketi: ayın raporları ve Luca dosyaları; ZIP indir veya e-postayla gönder */
export default async function Package({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const approver = (s.modules.ledger ?? 0) >= 3;
  const sp = await searchParams;
  const supabase = await createClient();
  let month = sp.ay && /^\d{4}-\d{2}$/.test(sp.ay) ? sp.ay : null;
  if (!month) {
    const { data: wm } = await supabase.rpc("gl_working_month");
    month = typeof wm === "string" ? wm : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 7);
  }
  const [{ data: set, error }, { data: accs }, { data: sends }] = await Promise.all([
    supabase.from("gl_package_settings").select("to_emails, cc_emails, mail_account_id, message").maybeSingle(),
    supabase.from("mail_accounts").select("id, email").order("email"),
    supabase.from("gl_package_sends").select("id, period, kind, to_emails, files, size, error, sent_at").order("sent_at", { ascending: false }).limit(15),
  ]);
  const accounts = (accs ?? []) as Array<{ id: string; email: string }>;
  const savedOther = set?.mail_account_id && !accounts.some((a) => a.id === set.mail_account_id);
  const list = (sends ?? []) as Send[];

  return (
    <>
      <PageHeader title="Mali müşavir paketi" subtitle="Ayın mizanı, yevmiyesi, bilançosu, gelir ve nakit akış tabloları, KDV özeti ve Luca dosyaları tek pakette" actions={<Link href={`/muhasebe/kokpit?ay=${month}`} className="text-sm font-semibold text-brand-700">Muhasebe kokpiti</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">{/relation|does not exist|schema cache/.test(error.message) ? "Supabase'de 20270222000000_gl_package.sql çalıştırılmalı." : error.message}</Notice>}
        <form className="flex flex-wrap gap-2"><input type="month" name="ay" defaultValue={month} className={`${inputCls} w-44`} /><button className={btnSecondary}>Göster</button></form>

        <form action="/muhasebe/paket/indir" method="get" className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
          <h2 className="font-bold">{month} paketi</h2>
          <input type="hidden" name="ay" value={month} />
          <input type="hidden" name="month" value={month} />
          <div className="grid sm:grid-cols-2 gap-2 text-sm">
            {PACKAGE_PARTS.map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" name="p" value={k} defaultChecked />{l}</label>)}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button className={btnSecondary}>ZIP olarak indir</button>
            {approver && <button formAction={glPackageEmail} className={btnPrimary} disabled={!set?.to_emails || !set?.mail_account_id}>E-postayla gönder{set?.to_emails ? ` · ${set.to_emails}` : ""}</button>}
          </div>
          {approver && (!set?.to_emails || !set?.mail_account_id) && <p className="text-xs text-[#7A4F00]">E-postayla göndermek için aşağıda alıcı adresini ve gönderen hesabı kaydedin.</p>}
          <p className="text-xs text-muted">Gönderim veya indirme kaydedilir; kokpitte &quot;Mali müşavir paketi&quot; maddesi tamamlanır. E-posta eki en çok 18 MB olabilir.</p>
        </form>

        {approver && (
          <form action={glPackageSettings} className="bg-white border border-line rounded-[14px] p-4 grid gap-3 md:grid-cols-2">
            <h2 className="font-bold md:col-span-2">Gönderim ayarları</h2>
            <label className="text-sm font-semibold flex flex-col gap-1">Mali müşavir e-posta adresi<input name="to" defaultValue={set?.to_emails ?? ""} placeholder="musavir@ornek.com" className={inputCls} required /></label>
            <label className="text-sm font-semibold flex flex-col gap-1">Bilgi (cc)<input name="cc" defaultValue={set?.cc_emails ?? ""} placeholder="isteğe bağlı, virgülle" className={inputCls} /></label>
            <label className="text-sm font-semibold flex flex-col gap-1">Gönderen hesap
              <select name="account" defaultValue={set?.mail_account_id ?? ""} className={inputCls}>
                <option value="">— seçin —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
                {savedOther && <option value={set!.mail_account_id!}>Başka kullanıcının hesabı (kayıtlı)</option>}
              </select>
              {!accounts.length && <span className="text-xs font-normal text-muted">Bağlı Gmail hesabınız yok: <Link href="/posta" className="text-brand-700">E-posta</Link> ekranından bağlayın.</span>}
            </label>
            <label className="text-sm font-semibold flex flex-col gap-1 md:col-span-2">E-posta notu<textarea name="message" rows={3} defaultValue={set?.message ?? ""} placeholder="ör. Ekim ayı paketi ektedir, KDV beyannamesi için kontrol eder misiniz?" className="rounded-[10px] border border-[#D5DEE8] px-3 py-2 text-sm" /></label>
            <div className="md:col-span-2"><PendingSubmit className={btnSecondary}>Kaydet</PendingSubmit></div>
          </form>
        )}

        <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
          <h2 className="font-bold">Gönderim geçmişi</h2>
          {!list.length && <p className="text-sm text-muted">Henüz paket indirilmedi ya da gönderilmedi.</p>}
          {list.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={th}>Zaman</th><th className={th}>Dönem</th><th className={th}>İşlem</th><th className={th}>Alıcı</th><th className={th}>Dosya</th><th className={th}>Durum</th></tr></thead>
                <tbody>
                  {list.map((x) => (
                    <tr key={x.id}>
                      <td className={`${td} whitespace-nowrap`}>{new Date(x.sent_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" })}</td>
                      <td className={td}>{x.period}</td>
                      <td className={td}>{x.kind === "email" ? "E-posta" : "İndirme"}</td>
                      <td className={td}>{x.to_emails ?? "—"}</td>
                      <td className={td}>{x.files.length}{x.size ? ` · ${(x.size / 1048576).toFixed(1)} MB` : ""}</td>
                      <td className={td}>{x.error ? <span className="text-bad">{x.error}</span> : <span className="text-[#1A7F52]">Tamam</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
