import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { saveAssistantSettings } from "./actions";
import { Chat } from "./Chat";

const SELF = ["Kaç gün yıllık iznim kaldı?", "Bu ayki bordromda neden kesinti var?", "Bu ay kaç gün geç kaldım?", "Önümüzdeki hafta vardiyam ne?", "Avans talebim ne durumda?", "Maaşlar ayın kaçında yatıyor?"];
const MANAGER = ["Geçen ay en çok fazla mesai yapan bölüm hangisi?", "Bugün kimler izinde?", "Bu ay en çok devamsızlık yapanlar kim?", "İzni en çok biriken 10 kişi?", "Onay bekleyen izin talepleri neler?"];
const PAY = ["Geçen ayın bordro toplamı bölümlere göre ne kadar?"];

/** İK asistanı: personel ve yöneticiler doğal dille soru sorar; yanıtlar yetki kapsamındaki verilerden üretilir */
export default async function AssistantPage() {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: me }, { data: comp, error }] = await Promise.all([
    supabase.from("employees").select("first_name").eq("user_id", s.userId).maybeSingle(),
    supabase.from("companies").select("assistant_enabled, assistant_daily_limit").eq("id", s.companyId).maybeSingle(),
  ]);
  const owner = s.role === "owner";
  const manager = ["owner", "accountant", "hr", "branch_manager", "safety"].includes(s.role);
  const suggestions = [...(me ? SELF.slice(0, manager ? 2 : 6) : []), ...(manager ? MANAGER : []), ...(["owner", "accountant"].includes(s.role) ? PAY : [])];
  const { data: usage } = owner ? await supabase.from("assistant_logs").select("tools, input_tokens, output_tokens, error, created_at").gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString()) : { data: [] };
  const tok = (usage ?? []).reduce((a, u) => ({ i: a.i + (u.input_tokens ?? 0), o: a.o + (u.output_tokens ?? 0) }), { i: 0, o: 0 });
  return (
    <>
      <PageHeader title="İK asistanı" subtitle="İzin, bordro, puantaj ve vardiya sorularınızı yazın" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[820px] w-full">
        {error && <Card><p className="text-sm">Bu bölüm için Supabase&apos;de <b>20261121000000_assistant.sql</b> çalıştırılmalı.</p></Card>}
        {owner && (
          <Card title="Asistan ayarları">
            <form action={saveAssistantSettings} className="flex flex-wrap gap-3 items-center text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={!!comp?.assistant_enabled} className="w-5 h-5" />Asistanı tüm kullanıcılara aç</label>
              <label className="flex items-center gap-2">Kişi başı günlük soru<input name="limit" type="number" min={1} max={500} defaultValue={comp?.assistant_daily_limit ?? 40} className="h-10 w-20 rounded-[10px] border border-[#D5DEE8] px-2" /></label>
              <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Kaydet</PendingSubmit>
            </form>
            <p className="text-xs text-muted">Son 30 gün: {(usage ?? []).length} soru · {Math.round(tok.i / 1000)} bin giriş, {Math.round(tok.o / 1000)} bin çıkış token{(usage ?? []).some((u) => u.error) ? ` · ${(usage ?? []).filter((u) => u.error).length} hata` : ""}.</p>
            <p className="text-xs text-muted">Sorular ve yanıt için gereken veriler (ad, izin günü, bordro tutarı gibi) yanıt üretmek üzere Anthropic&apos;in yapay zekâ servisine (yurt dışı) gönderilir; TC kimlik, IBAN ve iletişim bilgisi gönderilmez. KVKK md. 9 gereği yurt dışına aktarım için Anthropic ile standart sözleşme düzenleyip KVKK&apos;ya bildirmeniz ve aydınlatma metnine eklemeniz gerekir. Anthropic’in ticari koşullarına göre API ile gönderilen veriler varsayılan olarak model eğitiminde kullanılmaz.</p>
          </Card>
        )}
        {comp?.assistant_enabled ? <Chat suggestions={suggestions} name={me?.first_name ?? ""} /> : !owner && <Card><p className="text-sm text-muted">İK asistanı şirketiniz için henüz açılmadı.</p></Card>}
      </div>
    </>
  );
}
