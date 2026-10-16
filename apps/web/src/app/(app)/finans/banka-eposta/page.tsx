import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { BANK_MAIL_QUERY } from "@/lib/bank-mail";
import { assignBankMail, dismissBankMail, saveBankMailSettings, scanBankMailNow } from "@/lib/bank-mail-actions";
import { CopyText } from "@/components/CopyText";

export const dynamic = "force-dynamic";
export const metadata = { title: "Banka e-postası" };

const dt = (s: string | null) => (s ? new Date(s).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

/** Banka hareketlerinin e-postayla otomatik içe aktarılması: ayar, bekleyen ekler, son aktarımlar, bankalara gönderilecek talep metni */
export default async function BankMailPage() {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 2) redirect("/");
  const sb = await createClient();
  const [{ data: set, error }, { data: mails }, { data: accs }, { data: pend }, { data: seen }, { data: routes }] = await Promise.all([
    sb.from("fin_bank_mail_settings").select("mail_account_id, query, enabled, last_run_at, last_result").maybeSingle(),
    sb.from("mail_accounts").select("id, email").order("email"),
    sb.from("fin_accounts").select("id, name, bank_name, iban, currency").in("kind", ["bank", "pos", "credit_card"]).eq("is_active", true).order("sort"),
    sb.from("fin_bank_mail_pending").select("id, sender, subject, file_name, hint, row_count, rows, created_at").eq("done", false).order("created_at", { ascending: false }).limit(50),
    sb.from("fin_bank_mail_seen").select("ref, sender, file_name, rows, added, result, created_at, fin_accounts(name)").not("file_name", "is", null).order("created_at", { ascending: false }).limit(30),
    sb.from("fin_bank_mail_routes").select("id, sender, hint, fin_accounts(name)").order("created_at", { ascending: false }).limit(50),
  ]);
  const cfg = (set ?? null) as { mail_account_id: string | null; query: string | null; enabled: boolean; last_run_at: string | null; last_result: string | null } | null;
  const accounts = (accs ?? []) as { id: string; name: string; bank_name: string | null; iban: string | null; currency: string }[];
  const mailbox = ((mails ?? []) as { id: string; email: string }[]).find((m) => m.id === cfg?.mail_account_id)?.email;
  const pending = (pend ?? []) as { id: string; sender: string | null; subject: string | null; file_name: string | null; hint: string | null; row_count: number; rows: { date: string; amount: number }[]; created_at: string }[];
  const canSet = (s.modules.finance ?? 0) >= 3;
  const missingIban = accounts.filter((a) => a.bank_name && !a.iban);
  const request = `Sayın Yetkili,\n\n${s.companyName} olarak bankanız nezdindeki tüm vadesiz hesaplarımızın hesap hareketlerinin (ekstre) her iş günü MT940 formatında (MT940 mümkün değilse Excel olarak) ${mailbox ?? "banka@mbdentaire.com"} adresine e-posta ile gönderilmesini talep ederiz. Gün içi hareketler için MT942 de gönderilebilir.\n\nSaygılarımızla,\n${s.companyName}`;

  return (
    <>
      <PageHeader title="Banka e-postası" subtitle="Bankanın e-postayla gönderdiği ekstreler (MT940 / Excel) 15 dakikada bir okunur ve banka hesabına aktarılır"
        actions={<span className="flex gap-3 text-sm font-semibold"><Link href="/finans/banka-aktar" className="text-brand-700">Banka hareketleri ve eşleştirme →</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1200px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{/fin_bank_mail|schema cache/.test(error.message) ? "Supabase'de mbdental-banka-eposta.sql çalıştırılmalı." : error.message}</p>}

        <section className="grid gap-3 md:grid-cols-3">
          {([
            ["1", "Adres", mailbox ? `${mailbox} bağlı` : "Ayrı bir adres açın (ör. banka@mbdentaire.com) ve Posta ekranından Gmail olarak bağlayın", !!mailbox],
            ["2", "Bankalar", "Her bankadan ekstrenin her gün MT940 ile bu adrese gönderilmesini isteyin (talep metni aşağıda)", (seen ?? []).length > 0],
            ["3", "Hesap eşleşmesi", missingIban.length ? `${missingIban.length} banka hesabında IBAN eksik — Finans → Hesaplar'dan girin` : "Hesaplarda IBAN kayıtlı: ekstreler otomatik eşleşir", !missingIban.length],
          ] as const).map(([n, t, d, ok]) => (
            <div key={n} className={`rounded-[16px] border bg-white p-4 flex gap-3 ${ok ? "border-ok/40" : "border-line"}`}>
              <span className={`w-8 h-8 shrink-0 rounded-full grid place-items-center font-bold ${ok ? "bg-ok text-white" : "bg-[#EEF2F6] text-muted"}`}>{ok ? "✓" : n}</span>
              <div><div className="font-semibold">{t}</div><div className="text-sm text-muted">{d}</div></div>
            </div>
          ))}
        </section>

        <section className="rounded-[16px] border border-line bg-white p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px]">
            <div className="text-xs font-semibold text-muted">Son tarama</div>
            <div className="font-semibold">{dt(cfg?.last_run_at ?? null)}</div>
            <div className="text-sm text-muted">{cfg?.last_result ?? "Henüz çalışmadı."}</div>
          </div>
          <form action={scanBankMailNow}><PendingSubmit className="h-10 px-5 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Şimdi tara</PendingSubmit></form>
        </section>

        {pending.length > 0 && (
          <section className="rounded-[16px] border border-warn bg-white p-4 flex flex-col gap-3">
            <h2 className="font-display font-bold text-brand-800">Hesabı seçilmesi gereken ekstreler ({pending.length})</h2>
            <p className="text-sm text-muted">Ekte IBAN / hesap no bulunamadı ya da kayıtlı hesaplarla eşleşmedi. Bir kez seçin; &quot;hatırla&quot; işaretliyse bu gönderenin sonraki ekstreleri otomatik gider.</p>
            {pending.map((p) => {
              const sum = p.rows.reduce((a, r) => a + Number(r.amount), 0);
              const dates = p.rows.map((r) => r.date).sort();
              return (
                <form key={p.id} action={assignBankMail} className="rounded-[12px] border border-[#EEF2F6] p-3 flex flex-wrap items-center gap-2 text-sm">
                  <input type="hidden" name="id" value={p.id} />
                  <div className="flex-1 min-w-[260px]">
                    <div className="font-semibold">{p.file_name} <span className="text-muted font-normal">· {p.row_count} hareket · {dates[0]?.split("-").reverse().join(".")} – {dates[dates.length - 1]?.split("-").reverse().join(".")}</span></div>
                    <div className="text-xs text-muted">{p.sender} · {p.subject}{p.hint ? ` · hesap ipucu: ${p.hint}` : ""} · net {money(sum, "TRY")}</div>
                  </div>
                  <select name="account" required className="h-9 rounded-[10px] border border-[#D5DEE8] px-2"><option value="">Banka hesabı seçin</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.currency !== "TRY" ? ` (${a.currency})` : ""}</option>)}</select>
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="learn" defaultChecked /> hatırla</label>
                  <PendingSubmit className="h-9 px-3 rounded-[10px] bg-brand-700 text-white font-semibold">Aktar</PendingSubmit>
                </form>
              );
            })}
            <div className="flex flex-wrap gap-2">{pending.map((p) => <form key={p.id} action={dismissBankMail}><input type="hidden" name="id" value={p.id} /><PendingSubmit className="text-xs text-muted underline">{p.file_name} — yok say</PendingSubmit></form>)}</div>
          </section>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
            <h2 className="font-display font-bold text-brand-800">Son aktarılan ekstreler</h2>
            <ul className="flex flex-col divide-y divide-[#EEF2F6] text-sm">
              {((seen ?? []) as unknown as { ref: string; sender: string | null; file_name: string | null; rows: number | null; added: number | null; result: string | null; created_at: string; fin_accounts: { name: string } | null }[]).map((x) => (
                <li key={x.ref} className="py-2 flex flex-wrap gap-x-2">
                  <span className="font-semibold">{x.fin_accounts?.name ?? "—"}</span>
                  <span className="text-muted truncate max-w-[220px]">{x.file_name}</span>
                  <span className="ml-auto text-xs">{x.added ?? 0} yeni / {x.rows ?? 0}</span>
                  <span className="w-full text-[11px] text-muted">{dt(x.created_at)} · {x.sender} · {x.result}</span>
                </li>
              ))}
              {!(seen ?? []).length && <li className="py-4 text-muted">Henüz e-postayla gelen ekstre yok.</li>}
            </ul>
          </section>
          <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
            <h2 className="font-display font-bold text-brand-800">Bankalara gönderilecek talep</h2>
            <pre className="whitespace-pre-wrap text-sm bg-[#F7F9FB] rounded-[12px] p-3 font-sans">{request}</pre>
            <CopyText text={request} label="Metni kopyala" />
            <p className="text-xs text-muted">Şubeye e-posta / dilekçe olarak verin ya da müşteri temsilcinize iletin. QNB&apos;nin formunda &quot;MT940/MT942 formatında e-Posta ile almak istiyorum&quot; seçeneğini işaretleyin. Bazı bankalar internet şubesinde &quot;e-ekstre / hesap hareketi e-postası&quot; tanımına da izin verir.</p>
          </section>
        </div>

        {canSet && (
          <form action={saveBankMailSettings} className="rounded-[16px] border border-line bg-white p-4 flex flex-wrap items-end gap-3 text-sm">
            <h2 className="w-full font-display font-bold text-brand-800">Ayarlar</h2>
            <label className="flex flex-col gap-1">Taranacak Gmail hesabı
              <select name="account" defaultValue={cfg?.mail_account_id ?? ""} className="h-10 w-72 rounded-[10px] border border-[#D5DEE8] px-2">
                <option value="">Seçin</option>{((mails ?? []) as { id: string; email: string }[]).map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-[300px]">Gmail arama sorgusu (boş: varsayılan)<input name="query" defaultValue={cfg?.query ?? ""} placeholder={BANK_MAIL_QUERY} className="h-10 rounded-[10px] border border-[#D5DEE8] px-3 font-mono text-xs" /></label>
            <label className="flex items-center gap-2 h-10"><input type="checkbox" name="enabled" defaultChecked={cfg?.enabled ?? true} /> Otomatik tarama açık</label>
            <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Kaydet</PendingSubmit>
            <span className="w-full text-xs text-muted">Hesap listede yoksa önce <Link href="/posta" className="font-semibold text-brand-700">Posta</Link> ekranından Gmail hesabını bağlayın. Sadece ekstre için ayrı bir adres önerilir; ortak kutuda sorguya <span className="font-mono">to:banka@…</span> ekleyin.</span>
          </form>
        )}

        {(routes ?? []).length > 0 && (
          <section className="rounded-[16px] border border-line bg-white p-4">
            <h2 className="font-display font-bold text-brand-800 mb-2">Öğrenilen kurallar</h2>
            <ul className="text-sm flex flex-col gap-1">{((routes ?? []) as unknown as { id: string; sender: string | null; hint: string | null; fin_accounts: { name: string } | null }[]).map((r) => <li key={r.id}>{r.sender ?? "her gönderen"}{r.hint ? ` · ${r.hint}` : ""} → <b>{r.fin_accounts?.name}</b></li>)}</ul>
          </section>
        )}
      </div>
    </>
  );
}
