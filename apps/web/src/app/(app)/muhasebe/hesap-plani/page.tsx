import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Chip, Field, Notice, btnPrimary, btnSecondary, inputCls, page, td, textareaCls, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { ACC_KIND, type GlAccount, level } from "@/lib/gl";
import { glDeleteAccount, glImportAccounts, glSaveAccount } from "@/lib/gl-actions";

export const dynamic = "force-dynamic";

/** Hesap planı: ana hesaplar, alt hesaplar, düzenle / ekle / içe aktar */
export default async function ChartPage({ searchParams }: { searchParams: Promise<{ q?: string; sinif?: string; tum?: string; duzenle?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, { data: used }] = await Promise.all([
    supabase.from("gl_accounts").select("*").order("code").limit(5000),
    supabase.from("gl_lines").select("account_id").limit(20000),
  ]);
  const all = (data ?? []) as GlAccount[];
  const usedSet = new Set(((used ?? []) as Array<{ account_id: string }>).map((u) => u.account_id));
  const withChild = new Set(all.map((a) => a.parent_id).filter(Boolean) as string[]);
  const q = (sp.q ?? "").trim().toLocaleLowerCase("tr");
  const cls = sp.sinif && /^[1-9]$/.test(sp.sinif) ? sp.sinif : null;
  // varsayılan: kullanılan ana hesaplar + alt hesaplar; "tüm" ile bütün Tek Düzen Hesap Planı
  const rows = all.filter((a) => (!cls || a.code.startsWith(cls)) && (!q || a.code.startsWith(q) || a.name.toLocaleLowerCase("tr").includes(q))
    && (sp.tum || q || cls || !a.is_system || withChild.has(a.id) || usedSet.has(a.id)));
  const edit = sp.duzenle ? all.find((a) => a.id === sp.duzenle) : undefined;
  const canEdit = (s.modules.ledger ?? 0) >= 2;
  const link = (p: Record<string, string | null>) => { const u = new URLSearchParams(); Object.entries({ q: sp.q ?? null, sinif: cls, tum: sp.tum ?? null, ...p }).forEach(([k, v]) => v && u.set(k, v)); return `/muhasebe/hesap-plani${u.size ? `?${u}` : ""}`; };
  return (
    <>
      <PageHeader title="Hesap planı" subtitle="Tek Düzen Hesap Planı (7/A) ana hesapları hazır; alt hesaplarınızı ekleyin. Kasa, banka, kart ve cariler için alt hesap ilk kayıtta kendiliğinden açılır." actions={<Link href="/muhasebe" className="text-sm font-semibold text-brand-700">Genel muhasebe</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">Supabase&apos;de 20270206000000_gl_core.sql çalıştırılmalı.</Notice>}
        <div className="flex flex-wrap items-center gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "9"].map((c) => <Link key={c} href={link({ sinif: cls === c ? null : c })} className={`rounded-full px-3 py-1.5 text-sm font-semibold border ${cls === c ? "bg-brand-700 text-white border-brand-700" : "bg-white border-line"}`}>{c}</Link>)}
          <Link href={link({ tum: sp.tum ? null : "1" })} className="text-sm font-semibold text-brand-700">{sp.tum ? "Yalnız kullanılanlar" : "Tüm hesap planı"}</Link>
          <form className="ml-auto flex gap-2"><input name="q" defaultValue={sp.q ?? ""} placeholder="Kod ya da ad" className={`${inputCls} w-56`} />{cls && <input type="hidden" name="sinif" value={cls} />}<button className={btnSecondary}>Ara</button></form>
        </div>

        {canEdit && (
          <Card title={edit ? `Düzenle · ${edit.code}` : "Hesap ekle"} action={edit ? <Link href={link({ duzenle: null })} className="text-sm text-muted">Vazgeç</Link> : undefined}>
            <form action={glSaveAccount} className="grid gap-3 md:grid-cols-[160px_1fr_1fr_auto] items-end">
              {edit && <input type="hidden" name="id" value={edit.id} />}
              <Field label="Kod" hint="ör. 770.01"><input name="code" required defaultValue={edit?.code ?? ""} className={`${inputCls} num`} /></Field>
              <Field label="Ad"><input name="name" required maxLength={160} defaultValue={edit?.name ?? ""} className={inputCls} /></Field>
              <Field label="Not"><input name="note" maxLength={500} defaultValue={edit?.note ?? ""} className={inputCls} /></Field>
              <div className="flex items-center gap-3">{edit && <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="is_active" defaultChecked={edit.is_active} /> Aktif</label>}<PendingSubmit className={btnPrimary}>Kaydet</PendingSubmit></div>
            </form>
          </Card>
        )}

        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-xs text-muted"><th className={th}>Kod</th><th className={th}>Hesap adı</th><th className={th}>Tür</th><th className={th}>Bakiye yönü</th><th className={th}>Bağlı</th><th className={th}></th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className={a.is_active ? "" : "text-muted"}>
                  <td className={`${td} num whitespace-nowrap`} style={{ paddingLeft: 12 + (level(a.code) - 1) * 18 }}><Link href={`/muhasebe/kebir?hesap=${encodeURIComponent(a.code)}`} className={`text-brand-700 ${level(a.code) === 1 ? "font-bold" : ""}`}>{a.code}</Link></td>
                  <td className={td}>{a.name}{a.note && <span className="block text-xs text-muted">{a.note}</span>}</td>
                  <td className={td}><Chip>{ACC_KIND[a.kind] ?? a.kind}</Chip></td>
                  <td className={`${td} text-xs`}>{a.normal_side === "D" ? "Borç" : "Alacak"}</td>
                  <td className={`${td} text-xs text-muted`}>{a.link_type === "party" ? "Cari" : a.link_type === "fin_account" ? "Kasa / banka" : ""}{!a.postable && " · üst hesap"}</td>
                  <td className={`${td} text-right whitespace-nowrap`}>
                    {canEdit && <Link href={link({ duzenle: a.id })} className="text-xs font-semibold text-brand-700">Düzenle</Link>}
                    {canEdit && !usedSet.has(a.id) && !withChild.has(a.id) && <form action={glDeleteAccount} className="inline ml-3"><input type="hidden" name="id" value={a.id} /><PendingSubmit className="text-xs font-semibold text-bad">Sil</PendingSubmit></form>}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="py-10 text-center text-muted">Hesap yok.</td></tr>}
            </tbody>
          </table>
        </section>

        {canEdit && (
          <Card title="Excel'den hesap planı yapıştır">
            <p className="text-sm text-muted">Her satıra bir hesap: kod ve ad (Excel&apos;de iki sütun seçip yapıştırın; sekme ya da noktalı virgülle ayrılır). Var olan kodun adı güncellenir; üst hesaplar önce açılır.</p>
            <form action={glImportAccounts} className="flex flex-col gap-2">
              <textarea name="rows" rows={6} placeholder={"770.01\tKira giderleri\n770.02\tElektrik giderleri"} className={`${textareaCls} num`} />
              <div><PendingSubmit className={btnSecondary}>İçe aktar</PendingSubmit></div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
