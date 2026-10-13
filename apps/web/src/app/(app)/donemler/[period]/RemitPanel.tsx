"use client";
import { formatTL } from "@mb/core";
import { useActionForm } from "@/lib/use-action-form";
import { remitPay, remitUndo } from "@/lib/salary-plan-actions";
import type { PayAccount, Remit } from "@/lib/salary-plan";

const num = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ICON: Record<Remit["kind"], string> = { bes: "🏦", icra: "⚖️", sgk: "🛡️", vergi: "🧾" };

function RemitRow({ period, r, accounts, defaultDate, closed }: { period: string; r: Remit; accounts: PayAccount[]; defaultDate: string; closed: boolean }) {
  const { state, pending, formProps } = useActionForm(remitPay);
  const ctl = "h-10 rounded-lg border border-[#D5DEE8] bg-white px-2 text-ink";
  return (
    <li className="py-3 border-b border-[#EEF2F6] last:border-0 flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 items-baseline">
        <span className="font-semibold text-brand-800"><span aria-hidden>{ICON[r.kind]} </span>{r.label}</span>
        <span className="text-xs text-muted">{r.detail}</span>
        <span className="num ml-auto font-bold">{formatTL(r.due)}</span>
      </div>
      {r.paid ? (
        <form action={remitUndo} className="flex flex-wrap gap-3 items-center text-sm">
          <input type="hidden" name="id" value={r.paid.id} />
          <input type="hidden" name="period" value={period} />
          <span className="text-ok font-semibold">Ödendi ✓ {formatTL(r.paid.amount)} · {r.paid.date.split("-").reverse().join(".")}{r.paid.account ? ` · ${r.paid.account}` : ""}</span>
          {r.paid.amount !== r.due && <span className="text-xs text-warn">bordro tutarından {formatTL(Math.abs(r.due - r.paid.amount))} {r.paid.amount > r.due ? "fazla" : "eksik"}</span>}
          {!closed && <button className="h-9 px-3 rounded-lg border border-[#D5DEE8] text-[13px] font-semibold text-[#33414F]">Geri al</button>}
        </form>
      ) : closed ? (
        <span className="text-sm text-muted">Ödendi olarak işaretlenmemiş.</span>
      ) : (
        <form {...formProps} className="flex flex-wrap gap-2 items-end">
          <input type="hidden" name="period" value={period} />
          <input type="hidden" name="kind" value={r.kind} />
          <input type="hidden" name="ref_id" value={r.refId ?? ""} />
          <input type="hidden" name="label" value={r.label} />
          <label className="flex flex-col gap-1 text-xs text-muted">Ödenen tutar<input name="amount" defaultValue={num.format(r.due / 100)} inputMode="decimal" required className={`${ctl} num w-32 text-right`} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Tarih<input type="date" name="date" defaultValue={defaultDate} required className={ctl} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Hangi hesaptan
            <select name="account_id" defaultValue={accounts.find((a) => a.kind === "bank")?.id ?? accounts[0]?.id ?? ""} required className={ctl}>
              <option value="">— seçin —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.kind === "cash" ? " (kasa)" : ""}</option>)}
            </select>
          </label>
          <button disabled={pending || accounts.length === 0} className="h-10 px-4 rounded-lg bg-brand-700 text-white font-semibold disabled:opacity-40">{pending ? "…" : "Ödendi"}</button>
          {state && !state.ok && <span role="status" className="text-sm text-bad">{state.message}</span>}
        </form>
      )}
    </li>
  );
}

export function RemitPanel({ period, remits, accounts, defaultDate, closed }: { period: string; remits: Remit[]; accounts: PayAccount[]; defaultDate: string; closed: boolean }) {
  const due = remits.reduce((a, r) => a + r.due, 0);
  const paid = remits.reduce((a, r) => a + (r.paid?.amount ?? 0), 0);
  return (
    <section className="bg-white border border-line rounded-[14px] p-4 md:p-5 flex flex-col gap-1">
      <div className="flex flex-wrap gap-x-4 items-baseline justify-between">
        <h2 className="font-display font-bold text-brand-800">Kurum ödemeleri</h2>
        <span className="text-sm text-muted">Toplam {formatTL(due)} · ödendi {formatTL(paid)}</span>
      </div>
      <p className="text-xs text-muted">Tutarlar bordrodan hesaplanır. SGK ve muhtasarı mali müşavirin tahakkukuyla karşılaştırın; farklıysa ödenen tutarı düzeltip işaretleyin. Ödeme seçilen hesaptan düşer, &quot;Personel giderleri&quot;ne yazılır.</p>
      {remits.length ? (
        <ul>{remits.map((r) => <RemitRow key={r.key} period={period} r={r} accounts={accounts} defaultDate={defaultDate} closed={closed} />)}</ul>
      ) : (
        <p className="text-sm text-muted py-2">Bu dönem için kurum ödemesi yok (bordro hesaplanınca çıkar).</p>
      )}
    </section>
  );
}
