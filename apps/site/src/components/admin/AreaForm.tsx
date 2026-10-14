import Link from "next/link";
import { saveArea } from "@/lib/growth-actions";
import type { Area } from "@/lib/cms";
import { I18nField } from "./ui";

/** Şehir / ülke sayfası formu: boş bırakılan metinler sitede hazır şablonla doldurulur */
export function AreaForm({ area }: { area?: Area }) {
  return (
    <form action={saveArea} className="grid gap-5">
      {area && <input type="hidden" name="id" value={area.id} />}
      <div className="grid gap-4 rounded-xl border border-gypsum bg-white p-4 sm:grid-cols-4">
        <label className="grid gap-1 text-sm font-semibold text-navy">Tür
          <select name="kind" defaultValue={area?.kind ?? "city"} className="field font-normal"><option value="city">Şehir (Türkiye)</option><option value="country">Ülke</option></select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-navy">Adres (slug)<input name="slug" required defaultValue={area?.slug ?? ""} placeholder="istanbul" className="field font-normal" /></label>
        <label className="grid gap-1 text-sm font-semibold text-navy">Teslim (iş günü)<input name="shipping_days" type="number" min={0} max={60} defaultValue={area?.shipping_days ?? ""} className="field font-normal" /></label>
        <label className="grid gap-1 text-sm font-semibold text-navy">Sıra<input name="sort" type="number" defaultValue={area?.sort ?? 0} className="field font-normal" /></label>
      </div>
      <I18nField name="name" label="Şehir / ülke adı" value={area?.name} required />
      <I18nField name="title" label="Sayfa başlığı" value={area?.title} hint="Boşsa: “İstanbul diş protez laboratuvarı” gibi hazır başlık kullanılır." />
      <I18nField name="intro" label="Giriş paragrafı" value={area?.intro} multiline rows={3} hint="Boşsa teslim süresiyle birlikte hazır metin kullanılır. Yapay zekâ ve Google için ilk cümlede net cevap verin." />
      <I18nField name="body" label="Ayrıntılı içerik" value={area?.body} multiline rows={8} hint="O bölgedeki hekimler için kargo / kurye, örnek vakalar, yerel bilgiler. Boşsa kısa avantaj listesi görünür." />
      <I18nField name="delivery" label="Teslim bilgisi (kısa)" value={area?.delivery} hint="ör. “Aynı gün kurye”, “4 iş günü DHL”" />
      <label className="flex items-center gap-3 text-sm font-semibold text-navy"><input type="checkbox" name="is_active" defaultChecked={area?.is_active ?? true} className="h-5 w-5 accent-navy" /> Sitede yayında</label>
      <div className="flex gap-3"><button className="rounded-full bg-navy px-6 py-3 font-semibold text-white">Kaydet</button><Link href="/admin/bolgeler" className="px-3 py-3 font-semibold text-slate">Vazgeç</Link></div>
      <p className="text-xs text-slate">Bu bölgeye özel soru-cevap eklemek için Sıkça sorulanlar › soru › “Şehir / ülke sayfasında da göster”.</p>
    </form>
  );
}
