"use client";
import { useState } from "react";
import { useActionForm } from "@/lib/use-action-form";
import { supRfqSubmit } from "@/lib/supplier-public-actions";

type V = { currency: string; my_status: string; delivery_days: number | null; valid_until: string | null; my_note: string | null; quoted_by: string | null;
  lines: { id: string; name: string; qty: number; unit: string; unit_price: number | null; vat_rate: number; available: boolean; note: string | null }[] };
const inp = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white";

/** Tedarikçi teklif formu: kalem başına birim fiyat, KDV, "yok"; teslim süresi, geçerlilik; ya da teklif veremiyoruz */
export function QuoteForm({ token, open, v }: { token: string; open: boolean; v: V }) {
  const f = useActionForm(supRfqSubmit);
  const [decline, setDecline] = useState(false);
  const done = v.my_status === "quoted" || v.my_status === "declined";
  return (
    <form {...f.formProps} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="decline" value={decline ? "1" : "0"} />
      {done && <p className="rounded-xl bg-ok-bg text-ok p-3 text-sm font-semibold">{v.my_status === "quoted" ? "Teklifiniz alındı. İsterseniz aşağıdan güncelleyebilirsiniz." : "Teklif veremeyeceğinizi bildirdiniz."}</p>}
      <section className="rounded-[16px] bg-white border border-line overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead><tr className="text-left text-xs text-muted"><th className="p-3">Kalem</th><th className="p-3 text-right">Miktar</th><th className="p-3">Birim fiyat ({v.currency}, KDV hariç)</th><th className="p-3">KDV</th><th className="p-3">Yok</th><th className="p-3">Not</th></tr></thead>
          <tbody>
            {v.lines.map((l) => (
              <tr key={l.id} className="border-t border-[#EEF2F6]">
                <td className="p-3 font-semibold"><input type="hidden" name="line" value={l.id} />{l.name}</td>
                <td className="p-3 text-right tabular-nums">{Number(l.qty).toLocaleString("tr-TR")} {l.unit}</td>
                <td className="p-3"><input name={`p_${l.id}`} disabled={!open || decline} defaultValue={l.unit_price != null ? (l.unit_price / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : ""} inputMode="decimal" placeholder="0,00" className={`${inp} w-36 text-right`} /></td>
                <td className="p-3"><select name={`v_${l.id}`} disabled={!open || decline} defaultValue={String(l.vat_rate ?? 20)} className={`${inp} w-20`}>{[0, 1, 10, 20].map((x) => <option key={x} value={x}>%{x}</option>)}</select></td>
                <td className="p-3"><input type="checkbox" name={`na_${l.id}`} disabled={!open || decline} defaultChecked={l.unit_price != null && !l.available} className="w-5 h-5" aria-label="Bu kalem yok" /></td>
                <td className="p-3"><input name={`n_${l.id}`} disabled={!open || decline} defaultValue={l.note ?? ""} placeholder="Marka / not" className={`${inp} w-40`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {open && (
        <section className="rounded-[16px] bg-white border border-line p-4 flex flex-wrap gap-3 items-end">
          {!decline && <>
            <label className="flex flex-col gap-1 text-xs text-muted">Teslim süresi (gün)<input name="delivery_days" type="number" min={0} max={365} defaultValue={v.delivery_days ?? ""} className={`${inp} w-32`} /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Teklif geçerlilik tarihi<input name="valid_until" type="date" defaultValue={v.valid_until ?? ""} className={inp} /></label>
          </>}
          <label className="flex flex-col gap-1 text-xs text-muted flex-1 min-w-48">{decline ? "Neden teklif veremiyorsunuz?" : "Not"}<input name="note" defaultValue={v.my_note ?? ""} className={inp} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Adınız<input name="name" defaultValue={v.quoted_by ?? ""} className={inp} /></label>
          <button disabled={f.pending} className="h-11 px-6 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-50">{f.pending ? "Gönderiliyor…" : decline ? "Bildir" : done ? "Teklifi güncelle" : "Teklifi gönder"}</button>
          <button type="button" onClick={() => setDecline(!decline)} className="h-11 px-3 text-sm font-semibold text-bad">{decline ? "Vazgeç, teklif vereceğim" : "Teklif veremiyoruz"}</button>
        </section>
      )}
      {f.state && <p role="status" className={`rounded-xl p-3 text-sm font-semibold ${f.state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{f.state.message}</p>}
    </form>
  );
}
