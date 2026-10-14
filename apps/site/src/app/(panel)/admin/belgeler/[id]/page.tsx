import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, I18nField, PageHead } from "@/components/admin/ui";
import type { Credential } from "@/lib/cms";
import { saveCredential } from "@/lib/growth-actions";
import { t } from "@/lib/i18n";
import { CRED_UI } from "@/lib/pages-ui";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Belge" };
export default async function CredEdit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ hata?: string }> }) {
  const { id } = await params;
  const { hata } = await searchParams;
  let c: Credential | undefined;
  if (id !== "yeni") {
    if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
    const supabase = await createClient();
    const { data } = await supabase.from("cms_credentials").select("*").eq("id", id).maybeSingle();
    if (!data) notFound();
    c = data as Credential;
  }
  return (
    <>
      <PageHead title={c ? t(c.title, "tr") : "Yeni belge / basın kaydı"} />
      <Flash hata={hata} />
      <form action={saveCredential} className="grid gap-5">
        {c && <input type="hidden" name="id" value={c.id} />}
        <div className="grid gap-4 rounded-xl border border-gypsum bg-white p-4 sm:grid-cols-3">
          <label className="grid gap-1 text-sm font-semibold text-navy">Tür<select name="kind" defaultValue={c?.kind ?? "certificate"} className="field font-normal">{Object.entries(CRED_UI.tr.kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-semibold text-navy">Veren kurum / yayın<input name="issuer" defaultValue={c?.issuer ?? ""} placeholder="ör. TÜV, TİTCK, Dental Tribune" className="field font-normal" /></label>
          <label className="grid gap-1 text-sm font-semibold text-navy">Sıra<input name="sort" type="number" defaultValue={c?.sort ?? 0} className="field font-normal" /></label>
          <label className="grid gap-1 text-sm font-semibold text-navy">Tarih<input name="issued_on" type="date" defaultValue={c?.issued_on ?? ""} className="field font-normal" /></label>
          <label className="grid gap-1 text-sm font-semibold text-navy">Geçerlilik sonu<input name="valid_until" type="date" defaultValue={c?.valid_until ?? ""} className="field font-normal" /></label>
          <label className="grid gap-1 text-sm font-semibold text-navy">Bağlantı (PDF / haber)<input name="url" defaultValue={c?.url ?? ""} className="field font-normal" /></label>
          <label className="grid gap-1 text-sm font-semibold text-navy sm:col-span-3">Görsel / logo<input name="image_path" defaultValue={c?.image_path ?? ""} placeholder="medya yolu ya da https://" className="field font-normal" /></label>
        </div>
        <I18nField name="title" label="Başlık" value={c?.title} required />
        <I18nField name="summary" label="Açıklama" value={c?.summary} multiline rows={2} />
        <label className="flex items-center gap-3 text-sm font-semibold text-navy"><input type="checkbox" name="is_active" defaultChecked={c?.is_active ?? true} className="h-5 w-5 accent-navy" /> Sitede yayında</label>
        <div className="flex gap-3"><button className="rounded-full bg-navy px-6 py-3 font-semibold text-white">Kaydet</button><Link href="/admin/belgeler" className="px-3 py-3 font-semibold text-slate">Vazgeç</Link></div>
      </form>
    </>
  );
}
