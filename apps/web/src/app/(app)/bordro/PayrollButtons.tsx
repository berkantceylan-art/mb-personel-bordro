"use client";
import { useActionForm } from "@/lib/use-action-form";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { postDeductions, savePayroll, unpostDeductions } from "./actions";

export function PayrollButtons({ period, canPost, canUnpost }: { period: string; canPost: boolean; canUnpost: boolean }) {
  const { state: s1, pending: p1, formProps: a1Props } = useActionForm(savePayroll);
  const { state: s2, pending: p2, formProps: a2Props } = useActionForm(postDeductions);
  const { state: s3, formProps: a3Props } = useActionForm(unpostDeductions);
  // En son yapılan işlemin mesajı gösterilir
  const state = [s3, s2, s1].find(Boolean) ?? null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form {...a1Props}>
          <input type="hidden" name="period" value={period} />
          <button disabled={p1} className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">{p1 ? "Hesaplanıyor…" : "Bordroyu hesapla ve kaydet"}</button>
        </form>
        {canPost && (
          <form {...a2Props}>
            <input type="hidden" name="period" value={period} />
            <button disabled={p2} className="h-11 px-4 rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold disabled:opacity-60">{p2 ? "Yazılıyor…" : "BES ve icra kesintilerini cariye yaz"}</button>
          </form>
        )}
        {canUnpost && (
          <form {...a3Props} className="h-11 inline-flex items-center px-2">
            <input type="hidden" name="period" value={period} />
            <ConfirmSubmit label="Kesintileri geri al" question="BES ve icra kesintileri iptal edilsin mi?" className="text-sm font-semibold text-muted" />
          </form>
        )}
      </div>
      {state && <p role="status" className={`text-sm rounded-lg px-3 py-2 ${state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{state.message}</p>}
    </div>
  );
}
