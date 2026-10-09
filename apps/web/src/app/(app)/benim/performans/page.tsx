import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card } from "@/components/ui";
import { SCORE_LABEL, average, type Criterion } from "@/lib/performance";
import { formatDate } from "@/lib/session";
import { acknowledgeReview, submitSelfReview } from "../../performans/actions";
import { me, MyHeader, NotLinked } from "../_shared";

type R = { id: string; cycle_name: string; period_start: string; period_end: string; due_on: string | null; cycle_open: boolean; self_eval: boolean; criteria: Criterion[]; self_scores: Record<string, number> | null; self_comment: string | null; self_submitted_at: string | null; mgr_scores: Record<string, number> | null; mgr_comment: string | null; strengths: string | null; improvements: string | null; overall: number | null; shared_at: string | null; acknowledged_at: string | null };

/** Personel: öz değerlendirme ve paylaşılan sonuçlar */
export default async function MyPerformancePage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Performansım" />;
  const { data } = await supabase.rpc("my_reviews");
  const list = (data ?? []) as R[];
  return (
    <>
      <MyHeader title="Performansım" subtitle="Öz değerlendirme ve sonuçlarım" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        {list.length === 0 && <Card><p className="text-sm text-muted">Henüz bir değerlendirme döneminiz yok.</p></Card>}
        {list.map((r) => {
          const canSelf = r.cycle_open && r.self_eval && !r.shared_at;
          return (
            <Card key={r.id} title={r.cycle_name}>
              <div className="text-xs text-muted">{formatDate(r.period_start)} – {formatDate(r.period_end)}{r.due_on && canSelf ? ` · son gün ${formatDate(r.due_on)}` : ""}</div>
              {r.shared_at && (
                <div className="flex flex-col gap-3">
                  <div className="rounded-xl bg-brand-900 text-white p-4 flex items-baseline justify-between"><span className="text-sm text-white/80">Genel puanınız</span><span className="num text-3xl font-bold">{r.overall !== null ? Number(r.overall).toLocaleString("tr-TR") : "—"}<span className="text-base text-white/70"> / 5</span></span></div>
                  <ul className="text-sm divide-y divide-[#EEF2F6]">
                    {r.criteria.map((k) => <li key={k.key} className="py-1.5 flex justify-between gap-3"><span>{k.label}</span><span className="num font-semibold">{r.mgr_scores?.[k.key] ?? "—"}{r.self_scores?.[k.key] ? <span className="font-normal text-muted"> (siz: {r.self_scores[k.key]})</span> : null}</span></li>)}
                  </ul>
                  {r.strengths && <p className="text-sm"><b>Güçlü yönleriniz:</b> {r.strengths}</p>}
                  {r.improvements && <p className="text-sm"><b>Gelişim alanlarınız:</b> {r.improvements}</p>}
                  {r.mgr_comment && <p className="text-sm bg-[#F5F7FA] rounded-lg p-3">{r.mgr_comment}</p>}
                  {r.acknowledged_at ? <p className="text-xs text-ok font-semibold">✓ Okuduğunuzu bildirdiniz ({formatDate(r.acknowledged_at.slice(0, 10))})</p> : (
                    <form action={acknowledgeReview} className="flex flex-col gap-2">
                      <input type="hidden" name="id" value={r.id} />
                      <label className="flex flex-col gap-1 text-sm text-muted">Eklemek istedikleriniz (isteğe bağlı)<textarea name="note" rows={2} className="rounded-[10px] border border-[#D5DEE8] px-3 py-2 text-base" /></label>
                      <PendingSubmit className="h-12 rounded-[10px] bg-brand-700 text-white font-semibold">Okudum</PendingSubmit>
                    </form>
                  )}
                </div>
              )}
              {!r.shared_at && canSelf && (
                <form action={submitSelfReview} className="flex flex-col gap-3">
                  <input type="hidden" name="id" value={r.id} /><input type="hidden" name="keys" value={r.criteria.map((k) => k.key).join(",")} />
                  <p className="text-sm">{r.self_submitted_at ? "Öz değerlendirmenizi gönderdiniz; şefiniz değerlendirene kadar güncelleyebilirsiniz." : "Kendinizi her ölçüt için 1–5 arası puanlayın."}</p>
                  {r.criteria.map((k) => (
                    <fieldset key={k.key} className="flex flex-col gap-1.5">
                      <legend className="text-sm font-semibold mb-1">{k.label}</legend>
                      <div className="grid grid-cols-5 gap-1.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <label key={n} className="cursor-pointer" title={SCORE_LABEL[n]}><input type="radio" name={k.key} value={n} defaultChecked={r.self_scores?.[k.key] === n} className="peer sr-only" /><span className="h-12 rounded-lg border border-[#D5DEE8] grid place-items-center font-semibold peer-checked:bg-brand-700 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-brand-600">{n}</span></label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                  <p className="text-xs text-muted">1 {SCORE_LABEL[1]} · 3 {SCORE_LABEL[3]} · 5 {SCORE_LABEL[5]}</p>
                  <label className="flex flex-col gap-1 text-sm text-muted">Bu dönem neleri iyi yaptınız, neye ihtiyacınız var?<textarea name="comment" rows={3} defaultValue={r.self_comment ?? ""} className="rounded-[10px] border border-[#D5DEE8] px-3 py-2 text-base" /></label>
                  <PendingSubmit className="h-12 rounded-[10px] bg-brand-700 text-white font-semibold">{r.self_submitted_at ? "Güncelle" : "Gönder"}</PendingSubmit>
                  {average(r.self_scores, r.criteria) !== null && <p className="text-xs text-muted">Kendi ortalamanız: {average(r.self_scores, r.criteria)?.toLocaleString("tr-TR")}</p>}
                </form>
              )}
              {!r.shared_at && !canSelf && <p className="text-sm text-muted">Değerlendirmeniz tamamlanınca sonuç burada görünecek.</p>}
            </Card>
          );
        })}
      </div>
    </>
  );
}
