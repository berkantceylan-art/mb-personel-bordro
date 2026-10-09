import Link from "next/link";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { uploadMyDocument } from "./actions";

/** e-Devlet'te belgenin alındığı hizmet */
const EDEVLET: Record<string, { url: string; how: string }> = {
  "Nüfus kayıt örneği": { url: "https://www.turkiye.gov.tr/nvi-nufus-kayit-ornegi-belgesi-sorgulama", how: "Belge türü: Vukuatlı (aile) · Barkodlu belge oluştur → PDF indir" },
  "İkametgah belgesi": { url: "https://www.turkiye.gov.tr/nvi-yerlesim-yeri-ve-diger-adres-belgesi-sorgulama", how: "Yerleşim yeri belgesi → Barkodlu belge oluştur → PDF indir" },
  "Adli sicil kaydı": { url: "https://www.turkiye.gov.tr/adli-sicil-kaydi", how: "Kurum: Özel kurum/iş başvurusu → Belge oluştur → PDF indir" },
  "Askerlik durum belgesi": { url: "https://www.turkiye.gov.tr/mill-savunma-askerligim", how: "Askerliğim sayfasında Askerlik Durum Belgesi → Barkodlu belge oluştur → PDF indir (kadın personel için gerekmez)" },
  "SGK hizmet dökümü": { url: "https://www.turkiye.gov.tr/sgk-tescil-ve-hizmet-dokumu", how: "Barkodlu belge oluştur → PDF indir" },
  "Diploma": { url: "https://www.turkiye.gov.tr/yuksekogretim-mezun-belgesi-sorgulama", how: "Üniversite mezunları: mezun belgesi. Lise ve altı: diplomanın fotoğrafı" },
  "Kimlik fotokopisi": { url: "", how: "Kimlik kartınızın ön ve arka yüzünün fotoğrafı" },
  "Vesikalık fotoğraf": { url: "", how: "Düz fonda, yakın çekim bir fotoğraf" },
  "Ehliyet fotokopisi": { url: "", how: "Ehliyetinizin ön yüzünün fotoğrafı (varsa)" },
};

export default async function MyDocumentsPage() {
  const s = await getSession();
  const supabase = await createClient();
  const { data: me } = await supabase.from("employees").select("id, first_name").eq("user_id", s.userId).maybeSingle();
  if (!me) return <><PageHeader title="Belgelerim" /><div className="p-6 text-muted">Hesabınız bir personel kaydına bağlı değil.</div></>;
  const [{ data: types }, { data: docs }] = await Promise.all([
    supabase.from("document_types").select("id, name, required, description, sort_order, onboarding_step").eq("onboarding_step", 2).order("sort_order"),
    supabase.from("employee_documents").select("id, document_type_id, file_name, uploaded_at").eq("employee_id", me.id).order("uploaded_at"),
  ]);
  const byType = new Map<string, NonNullable<typeof docs>>();
  for (const d of docs ?? []) byType.set(d.document_type_id, [...(byType.get(d.document_type_id) ?? []), d]);
  const list = types ?? [];
  const missing = list.filter((t) => t.required && !byType.has(t.id)).length;

  return (
    <>
      <PageHeader title="Belgelerim" subtitle={missing ? `${missing} zorunlu belge eksik` : "Zorunlu belgeler tamam"} actions={<Link href="/benim" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">← Ana sayfa</Link>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        <Card title="Nasıl yapılır?">
          <ol className="text-sm list-decimal pl-5 flex flex-col gap-1">
            <li>Belgenin yanındaki <b>e-Devlet&apos;te aç</b> bağlantısına dokunun; e-Devlet şifrenizle girin.</li>
            <li>Belgeyi oluşturup <b>PDF olarak indirin</b> (telefonunuzun İndirilenler klasörüne iner).</li>
            <li>Buraya dönüp <b>Dosya seç</b> ile indirdiğiniz PDF&apos;i seçin ve <b>Yükle</b>ye dokunun. Kimlik ve fotoğraf için kamerayla çekebilirsiniz.</li>
          </ol>
          <p className="text-xs text-muted">Belgeler yalnız İK tarafından görülür. Yanlış yüklediyseniz tekrar yükleyin; İK eskisini siler.</p>
        </Card>
        <ul className="flex flex-col gap-3">
          {list.map((t) => {
            const files = byType.get(t.id) ?? [];
            const g = EDEVLET[t.name];
            return (
              <li key={t.id} className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-2">
                <div className="flex gap-2.5 items-start">
                  <span aria-hidden className={`mt-1.5 w-3 h-3 rounded-full shrink-0 ${files.length ? "bg-[#1E7A4C]" : t.required ? "bg-[#B42318]" : "bg-[#C5D0DC]"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{t.name}{!t.required && <span className="text-muted font-normal"> · isteğe bağlı</span>}</div>
                    <div className="text-xs text-muted">{g?.how ?? t.description ?? ""}</div>
                    {files.map((f) => <div key={f.id} className="text-xs text-ok mt-1">✓ {f.file_name ?? "Dosya"} · {formatDate(f.uploaded_at.slice(0, 10))}</div>)}
                  </div>
                </div>
                {g?.url && (
                  <a href={g.url} target="_blank" rel="noreferrer" className="h-11 inline-flex items-center justify-center rounded-[10px] bg-[#E31E24] text-white font-semibold">e-Devlet&apos;te aç</a>
                )}
                <form action={uploadMyDocument} className="flex flex-wrap gap-2 items-center">
                  <input type="hidden" name="typeId" value={t.id} />
                  <input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.heic,image/*,application/pdf" aria-label={`${t.name} yükle`} className="text-sm flex-1 min-w-48" />
                  <PendingSubmit className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">{files.length ? "Tekrar yükle" : "Yükle"}</PendingSubmit>
                </form>
              </li>
            );
          })}
          {list.length === 0 && <li className="text-muted text-sm">Belge türleri tanımlı değil (İK: 20261029000000_onboarding_docs.sql).</li>}
        </ul>
      </div>
    </>
  );
}
