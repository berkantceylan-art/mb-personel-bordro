import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card } from "@/components/ui";
import { formatDate } from "@/lib/session";
import { me, MyHeader, NotLinked } from "../_shared";
import { answerChange, sendDefense } from "./actions";

type Letter = { kind: "savunma" | "degisiklik"; id: string; title: string; body: string; sent_at: string; due: string | null; answered_at: string | null; answer: string | null };

/** Personel: savunma istemleri, çalışma koşulu değişikliği bildirimleri, analık tarihleri ve izin planı */
export default async function MyLettersPage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Bana gelen yazılar" />;
  const year = new Date().getFullYear();
  const [{ data: letters, error }, { data: mat }, { data: plans }] = await Promise.all([
    supabase.rpc("my_letters"),
    supabase.rpc("my_maternity"),
    supabase.from("leave_plans").select("start_date, end_date, days, note").eq("employee_id", e.id).gte("year", year).order("start_date"),
  ]);
  const list = (letters ?? []) as Letter[];
  const m = ((mat ?? []) as Array<{ expected_birth: string | null; birth_date: string | null; leave_start: string | null; leave_end: string | null; milk_until: string | null }>)[0];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <MyHeader title="Bana gelen yazılar" subtitle="Savunma istemi, değişiklik bildirimi, izin planım" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        {error && <Card><p className="text-sm text-muted">Bu bölüm henüz etkin değil.</p></Card>}
        {!error && list.length === 0 && <Card><p className="text-sm text-muted">Size gönderilmiş bir yazı yok.</p></Card>}
        {list.map((l) => {
          const late = l.due && l.due < today && !l.answered_at;
          return (
            <Card key={l.kind + l.id} title={l.title}>
              <div className="text-xs text-muted">{formatDate(l.sent_at.slice(0, 10))} tarihinde gönderildi{l.due ? ` · son gün ${formatDate(l.due)}` : ""}</div>
              <p className="whitespace-pre-line text-[15px] border border-line rounded-lg p-3 bg-[#FAFBFC]">{l.body}</p>
              {l.kind === "savunma" && <p className="text-xs text-muted">İş Kanunu md. 19 gereği, hakkınızdaki iddia için yazılı savunmanız isteniyor. Savunma vermemeniz hakkınızdaki işlemi durdurmaz; süre içinde savunma vermezseniz bu hakkınızı kullanmamış sayılırsınız.</p>}
              {l.kind === "degisiklik" && <p className="text-xs text-muted">İş Kanunu md. 22: çalışma koşullarında esaslı değişiklik ancak yazılı kabulünüzle bağlayıcı olur. Altı iş günü içinde kabul etmezseniz değişiklik sizi bağlamaz.</p>}
              {l.answered_at ? (
                <div className="bg-[#E6F4EC] rounded-lg p-3 text-sm"><b>{formatDate(l.answered_at.slice(0, 10))} yanıtınız:</b><p className="whitespace-pre-line mt-1">{l.answer}</p></div>
              ) : l.kind === "savunma" ? (
                <form action={sendDefense} className="flex flex-col gap-2">
                  <input type="hidden" name="id" value={l.id} />
                  <textarea name="text" required rows={5} placeholder="Savunmanızı yazın" aria-label="Savunma" className="rounded-[10px] border border-[#D5DEE8] bg-white px-3 py-2 text-base" />
                  {late && <p className="text-xs text-warn font-semibold">Süre geçti; yine de gönderebilirsiniz.</p>}
                  <PendingSubmit className="h-12 rounded-[10px] bg-brand-700 text-white font-semibold">Savunmamı gönder</PendingSubmit>
                </form>
              ) : (
                <form action={answerChange} className="flex flex-col gap-2">
                  <input type="hidden" name="id" value={l.id} />
                  <input name="note" placeholder="Not (isteğe bağlı)" aria-label="Not" className="h-12 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-base" />
                  <div className="grid grid-cols-2 gap-2">
                    <PendingSubmit name="accept" value="1" className="h-12 rounded-[10px] bg-brand-700 text-white font-semibold">Kabul ediyorum</PendingSubmit>
                    <PendingSubmit name="accept" value="0" className="h-12 rounded-[10px] border border-[#E3B4AE] bg-white text-bad font-semibold">Kabul etmiyorum</PendingSubmit>
                  </div>
                </form>
              )}
            </Card>
          );
        })}
        {m && (
          <Card title="Doğum ve süt izni">
            <ul className="text-sm divide-y divide-[#EEF2F6]">
              {m.expected_birth && <li className="py-2 flex justify-between"><span>Beklenen doğum</span><b>{formatDate(m.expected_birth)}</b></li>}
              {m.birth_date && <li className="py-2 flex justify-between"><span>Doğum tarihi</span><b>{formatDate(m.birth_date)}</b></li>}
              {m.leave_start && m.leave_end && <li className="py-2 flex justify-between"><span>Doğum izni</span><b>{formatDate(m.leave_start)} – {formatDate(m.leave_end)}</b></li>}
              {m.milk_until && <li className="py-2 flex justify-between"><span>Süt izni (günde 1,5 saat)</span><b>{formatDate(m.milk_until)} tarihine kadar</b></li>}
            </ul>
          </Card>
        )}
        {(plans ?? []).length > 0 && (
          <Card title="Yıllık izin planım">
            <ul className="text-sm divide-y divide-[#EEF2F6]">{(plans ?? []).map((p, i) => (
              <li key={i} className="py-2 flex justify-between gap-2"><span>{formatDate(p.start_date)} – {formatDate(p.end_date)}{p.note ? ` · ${p.note}` : ""}</span><b>{Number(p.days)} gün</b></li>
            ))}</ul>
            <p className="text-xs text-muted">Plan değişikliği için İK ile görüşün ya da İzin iste bölümünden talep oluşturun.</p>
          </Card>
        )}
      </div>
    </>
  );
}
