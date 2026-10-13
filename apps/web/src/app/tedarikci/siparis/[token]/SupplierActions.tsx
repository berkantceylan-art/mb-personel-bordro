"use client";
import { useState } from "react";
import { useActionForm } from "@/lib/use-action-form";
import { supAck, supShip } from "@/lib/supplier-public-actions";

const inp = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white";

export function SupplierActions({ token, acked, shipped, expected }: { token: string; acked: boolean; shipped: boolean; expected: string | null }) {
  const ack = useActionForm(supAck);
  const ship = useActionForm(supShip);
  const [decline, setDecline] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {!acked && (
        <form {...ack.formProps} className="flex flex-col gap-2 rounded-[12px] border border-line p-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="ok" value={decline ? "0" : "1"} />
          <b className="text-sm">{decline ? "Siparişi karşılayamıyorum" : "Siparişi aldım"}</b>
          <div className="flex flex-wrap gap-2">
            <input name="name" placeholder="Adınız" aria-label="Adınız" className={`${inp} flex-1 min-w-[160px]`} />
            {!decline && <label className="flex items-center gap-2 text-sm">Termin <input type="date" name="date" defaultValue={expected ?? ""} className={inp} /></label>}
          </div>
          <textarea name="note" rows={2} placeholder={decline ? "Neden? (ör. stokta yok, şu tarihte gelir, muadil önerimiz…)" : "Not (isteğe bağlı)"} aria-label="Not" className="rounded-[10px] border border-[#D5DEE8] p-3" />
          <div className="flex flex-wrap gap-2">
            <button disabled={ack.pending} className={`h-11 px-5 rounded-[10px] font-bold text-white disabled:opacity-50 ${decline ? "bg-[#B42318]" : "bg-[#0A7D4F]"}`}>{ack.pending ? "Gönderiliyor…" : decline ? "Bildir" : "✓ Siparişi onayla"}</button>
            <button type="button" onClick={() => setDecline((x) => !x)} className="h-11 px-4 rounded-[10px] border border-[#D5DEE8] text-sm font-semibold">{decline ? "← Vazgeç" : "Karşılayamıyorum"}</button>
          </div>
          {ack.state && <p role="status" className={`text-sm rounded-lg px-3 py-2 ${ack.state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{ack.state.message}</p>}
        </form>
      )}
      {!shipped && (
        <form {...ship.formProps} className="flex flex-col gap-2 rounded-[12px] border border-line p-3">
          <input type="hidden" name="token" value={token} />
          <b className="text-sm">Sevk ettim</b>
          <div className="flex flex-wrap gap-2">
            <input name="waybill" placeholder="İrsaliye / kargo takip no" aria-label="İrsaliye no" className={`${inp} flex-1 min-w-[200px]`} />
            <input name="note" placeholder="Not (isteğe bağlı)" aria-label="Sevk notu" className={`${inp} flex-1 min-w-[200px]`} />
          </div>
          <button disabled={ship.pending} className="h-11 px-5 self-start rounded-[10px] bg-[#0A3D73] text-white font-bold disabled:opacity-50">{ship.pending ? "Gönderiliyor…" : "🚚 Sevk edildi olarak bildir"}</button>
          {ship.state && <p role="status" className={`text-sm rounded-lg px-3 py-2 ${ship.state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{ship.state.message}</p>}
        </form>
      )}
    </div>
  );
}
