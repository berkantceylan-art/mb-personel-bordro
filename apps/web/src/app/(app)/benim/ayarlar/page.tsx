import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { MyHeader } from "../_shared";
import { savePrefs } from "./actions";
import { CATS } from "./cats";

export default async function MySettingsPage() {
  const s = await getSession();
  const supabase = await createClient();
  const { data: p } = await supabase.from("notification_prefs").select("*").eq("user_id", s.userId).maybeSingle();
  const muted = new Set<string>((p?.muted as string[] | undefined) ?? []);
  return (
    <>
      <MyHeader title="Ayarlar" subtitle="Bildirimler ve görünüm" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[640px]">
        <form action={savePrefs} className="flex flex-col gap-4">
          <Card title="Telefon bildirimleri">
            <label className="flex gap-3 items-center text-sm"><input type="checkbox" name="push" defaultChecked={p ? p.push !== false : true} className="w-5 h-5" /><span><b>Telefona bildirim gelsin</b><span className="block text-xs text-muted">Kapatırsanız bildirimler yalnız uygulamadaki listede görünür.</span></span></label>
            <div className="text-xs uppercase tracking-wide text-muted mt-2">Hangi konularda</div>
            {CATS.map(([k, l, d]) => (
              <label key={k} className="flex gap-3 items-center text-sm py-1"><input type="checkbox" name={`cat_${k}`} defaultChecked={!muted.has(k)} className="w-5 h-5" /><span>{l}{d && <span className="block text-xs text-muted">{d}</span>}</span></label>
            ))}
          </Card>
          <Card title="Görünüm">
            <label className="flex gap-3 items-center text-sm"><input type="checkbox" name="big_text" defaultChecked={p?.big_text === true} className="w-5 h-5" /><span><b>Büyük yazı ve düğmeler</b><span className="block text-xs text-muted">Yazılar ve dokunma alanları büyür; iş ortamında eldivenle kullanım için.</span></span></label>
          </Card>
          <PendingSubmit className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Kaydet</PendingSubmit>
        </form>
      </div>
    </>
  );
}
