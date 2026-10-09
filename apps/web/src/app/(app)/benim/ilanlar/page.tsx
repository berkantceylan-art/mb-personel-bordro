import { formatTL } from "@mb/core";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card } from "@/components/ui";
import { STAGE_LABEL } from "@/lib/recruiting";
import { formatDate } from "@/lib/session";
import { me, MyHeader, NotLinked } from "../_shared";
import { referFriend } from "./actions";

const input = "h-12 w-full rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-base";

/** İç ilanlar ve "arkadaşını öner" */
export default async function MyJobsPage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="İş ilanları" />;
  const [{ data: posts }, { data: refs }] = await Promise.all([
    supabase.from("job_postings").select("id, title, description, employment_type, experience, referral_bonus, departments(name)").eq("status", "open").order("created_at", { ascending: false }),
    supabase.rpc("my_referrals"),
  ]);
  const list = posts ?? [];
  return (
    <>
      <MyHeader title="İş ilanları" subtitle="Açık pozisyonlar · arkadaşını öner" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        {list.length === 0 && <Card><p className="text-sm text-muted">Şu an açık ilan yok.</p></Card>}
        {list.map((p) => (
          <Card key={p.id} title={p.title}>
            <div className="text-xs text-muted">{[(p.departments as unknown as { name: string } | null)?.name, p.employment_type, p.experience].filter(Boolean).join(" · ")}</div>
            {p.description && <p className="text-sm whitespace-pre-line">{p.description}</p>}
            {p.referral_bonus ? <p className="text-sm font-semibold text-ok">Önerdiğiniz kişi işe alınırsa {formatTL(Number(p.referral_bonus))} tavsiye primi</p> : null}
          </Card>
        ))}
        <Card title="Arkadaşını öner">
          <form action={referFriend} className="flex flex-col gap-3 text-sm">
            <label className="flex flex-col gap-1 font-semibold text-[#33475B]">Pozisyon<select name="posting_id" className={input}><option value="">Genel (uygun bir iş)</option>{list.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 font-semibold text-[#33475B]">Ad<input name="first_name" required className={input} /></label>
              <label className="flex flex-col gap-1 font-semibold text-[#33475B]">Soyad<input name="last_name" className={input} /></label>
            </div>
            <label className="flex flex-col gap-1 font-semibold text-[#33475B]">Cep telefonu<input name="phone" type="tel" inputMode="tel" required placeholder="05xx xxx xx xx" className={input} /></label>
            <label className="flex flex-col gap-1 font-semibold text-[#33475B]">Neden öneriyorsunuz?<input name="note" placeholder="Deneyimi, tanıdığınız işler…" className={input} /></label>
            <label className="flex gap-3 items-start text-[#33475B]"><input type="checkbox" name="consent" required className="w-5 h-5 mt-0.5 shrink-0" /><span>Arkadaşım adının ve telefonunun işe alım için paylaşılmasına izin verdi.</span></label>
            <PendingSubmit className="h-12 rounded-[10px] bg-brand-700 text-white font-semibold">Öner</PendingSubmit>
          </form>
        </Card>
        {(refs ?? []).length > 0 && (
          <Card title="Önerilerim">
            <ul className="text-sm divide-y divide-[#EEF2F6]">
              {(refs as Array<{ tracking_code: string; name: string; title: string; stage: string; created_at: string }>).map((r) => (
                <li key={r.tracking_code} className="py-2 flex justify-between gap-3"><span><b>{r.name}</b><span className="block text-xs text-muted">{r.title} · {formatDate(r.created_at)}</span></span><span className="text-xs font-semibold self-center">{STAGE_LABEL[r.stage]}</span></li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
