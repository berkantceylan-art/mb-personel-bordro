import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card } from "@/components/ui";
import { REQUEST_TYPES } from "@/lib/kvkk";
import { formatDate } from "@/lib/session";
import { me, MyHeader, NotLinked } from "../_shared";
import { giveConsent, sendKvkkRequest } from "./actions";

/** Personel: aydınlatma metni, açık rızalar (ver / geri al), KVKK başvurularım */
export default async function MyKvkkPage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Kişisel verilerim (KVKK)" />;
  const [{ data: notices }, { data: consents }, { data: reqs }] = await Promise.all([
    supabase.from("kvkk_notices").select("id, audience, kind, title, body, version").eq("active", true).eq("audience", "employee").order("kind", { ascending: false }),
    supabase.from("kvkk_consents").select("notice_id, granted, created_at").eq("employee_id", e.id).is("revoked_at", null),
    supabase.from("kvkk_requests").select("id, request_type, details, status, received_at, due_on, response").eq("employee_id", e.id).order("received_at", { ascending: false }),
  ]);
  const c = new Map((consents ?? []).map((x) => [x.notice_id, x]));
  const STATUS: Record<string, string> = { open: "Alındı", in_progress: "İnceleniyor", answered: "Yanıtlandı", rejected: "Reddedildi" };
  return (
    <>
      <MyHeader title="Kişisel verilerim (KVKK)" subtitle="Aydınlatma metni, izinlerim ve başvurularım" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        {(notices ?? []).length === 0 && <Card><p className="text-sm text-muted">Şirketiniz henüz aydınlatma metnini yayınlamadı.</p></Card>}
        {(notices ?? []).filter((n) => n.kind === "aydinlatma").map((n) => (
          <Card key={n.id} title={n.title}>
            <div className="max-h-[50vh] overflow-y-auto whitespace-pre-line text-[15px] leading-relaxed border border-line rounded-lg p-3 bg-[#FAFBFC]">{n.body}</div>
            {c.has(n.id) ? <p className="text-sm text-ok font-semibold">✓ {formatDate(c.get(n.id)!.created_at.slice(0, 10))} tarihinde okudunuz (sürüm {n.version})</p> : (
              <form action={giveConsent}><input type="hidden" name="id" value={n.id} /><input type="hidden" name="granted" value="1" /><PendingSubmit className="h-12 w-full rounded-[10px] bg-brand-700 text-white font-semibold">Okudum, bilgilendirildim</PendingSubmit></form>
            )}
          </Card>
        ))}
        {(notices ?? []).some((n) => n.kind === "acik_riza") && (
          <Card title="İzinlerim (açık rıza)">
            <p className="text-xs text-muted">Bu izinler isteğe bağlıdır; vermemeniz ya da geri almanız işinizi etkilemez.</p>
            {(notices ?? []).filter((n) => n.kind === "acik_riza").map((n) => {
              const on = c.get(n.id)?.granted === true;
              return (
                <div key={n.id} className="border-b border-[#EEF2F6] last:border-0 pb-3 flex flex-col gap-2">
                  <div className="font-semibold text-sm">{n.title}</div>
                  <p className="text-sm text-muted">{n.body}</p>
                  <form action={giveConsent} className="flex items-center gap-3">
                    <input type="hidden" name="id" value={n.id} /><input type="hidden" name="granted" value={on ? "0" : "1"} />
                    <span className={`text-sm font-semibold ${on ? "text-ok" : "text-muted"}`}>{on ? "İzin verdiniz" : c.has(n.id) ? "İzin vermediniz" : "Henüz seçmediniz"}</span>
                    <PendingSubmit className={`h-11 px-4 rounded-[10px] text-sm font-semibold ml-auto ${on ? "border border-[#E3B4AE] bg-white text-bad" : "bg-brand-700 text-white"}`}>{on ? "İzni geri al" : "İzin veriyorum"}</PendingSubmit>
                  </form>
                </div>
              );
            })}
          </Card>
        )}
        <Card title="KVKK başvurusu yap">
          <p className="text-xs text-muted">KVKK md. 11 kapsamındaki haklarınız için başvurun; en geç 30 gün içinde ücretsiz yanıtlanır.</p>
          <form action={sendKvkkRequest} className="flex flex-col gap-2">
            <select name="type" className="h-12 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-base" aria-label="Talep türü">{Object.entries(REQUEST_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <textarea name="details" required rows={3} placeholder="Talebinizi yazın" className="rounded-[10px] border border-[#D5DEE8] bg-white px-3 py-2 text-base" aria-label="Talep" />
            <PendingSubmit className="h-12 rounded-[10px] bg-brand-700 text-white font-semibold">Gönder</PendingSubmit>
          </form>
        </Card>
        {(reqs ?? []).length > 0 && (
          <Card title="Başvurularım">
            <ul className="text-sm divide-y divide-[#EEF2F6]">{(reqs ?? []).map((r) => (
              <li key={r.id} className="py-2 flex flex-col gap-1"><div className="flex justify-between gap-2"><b>{REQUEST_TYPES[r.request_type]}</b><span className="text-xs font-semibold">{STATUS[r.status]}</span></div><span className="text-xs text-muted">{formatDate(r.received_at.slice(0, 10))} · son gün {formatDate(r.due_on)}</span>{r.response && <p className="bg-[#E6F4EC] rounded-lg p-2">{r.response}</p>}</li>
            ))}</ul>
          </Card>
        )}
      </div>
    </>
  );
}
