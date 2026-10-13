"use client";
import { useState } from "react";
import { useActionForm } from "@/lib/use-action-form";
import { wizAdvance, wizBonus, wizMissing, type WizResult } from "@/lib/wizard-actions";

const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white";
const Msg = ({ s }: { s: WizResult | null }) =>
  s ? <span role="status" className={`text-sm rounded-lg px-3 py-1.5 ${s.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{s.message}</span> : null;

export function MissingForm({ employeeId, period, label }: { employeeId: string; period: string; label: string }) {
  const { state, pending, formProps } = useActionForm(wizMissing);
  return (
    <form {...formProps} className="flex flex-wrap gap-3 items-end">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="period" value={period} />
      <label className="flex flex-col gap-1 text-xs text-muted">Devamsızlık / ücretsiz izin nereden kesilsin
        <select name="pay_side" defaultValue="BOTH" className={input}>
          <option value="BOTH">Resmi + elden</option>
          <option value="OFFICIAL">Sadece resmi</option>
          <option value="CASH">Sadece elden</option>
        </select>
      </label>
      <button disabled={pending} className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">{pending ? "Yazılıyor…" : label}</button>
      <Msg s={state} />
    </form>
  );
}

export function BonusForm({ employeeId, period }: { employeeId: string; period: string }) {
  const { state, pending, formProps } = useActionForm(wizBonus);
  return (
    <form {...formProps} className="flex flex-wrap gap-3 items-end">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="period" value={period} />
      <label className="flex flex-col gap-1 text-xs text-muted">Prim (personelin eline geçecek net)<input name="amount" required inputMode="decimal" placeholder="2.500" className={`${input} w-36 num`} /></label>
      <label className="flex flex-col gap-1 text-xs text-muted">Nereden
        <select name="side" defaultValue="CASH" className={input}>
          <option value="CASH">Elden</option>
          <option value="OFFICIAL">Resmi (bordroya brüt eklenir)</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">Açıklama<input name="note" placeholder="ör. performans" className={`${input} w-48`} /></label>
      <button disabled={pending} className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">Prim ekle</button>
      <Msg s={state} />
    </form>
  );
}

export function AdvanceForm({ employeeId, period, today, accounts }: { employeeId: string; period: string; today: string; accounts: Array<{ id: string; name: string; kind: "bank" | "cash" }> }) {
  const { state, pending, formProps } = useActionForm(wizAdvance);
  const [channel, setChannel] = useState<"CASH" | "BANK">("CASH");
  const list = accounts.filter((a) => a.kind === (channel === "BANK" ? "bank" : "cash"));
  const seg = (on: boolean) => `h-11 px-4 rounded-[10px] font-semibold ${on ? "bg-brand-700 text-white" : "border border-[#D5DEE8] bg-white text-[#33414F]"}`;
  return (
    <form {...formProps} className="flex flex-wrap gap-3 items-end">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="period" value={period} />
      <input type="hidden" name="channel" value={channel} />
      <div className="flex flex-col gap-1 text-xs text-muted">Kanal
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setChannel("CASH")} className={seg(channel === "CASH")}>Elden</button>
          <button type="button" onClick={() => setChannel("BANK")} className={seg(channel === "BANK")}>Banka</button>
        </div>
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted">Tutar<input name="amount" required inputMode="decimal" placeholder="5.000" className={`${input} w-32 num`} /></label>
      <label className="flex flex-col gap-1 text-xs text-muted">Tarih<input type="date" name="date" required defaultValue={today} className={input} /></label>
      <label className="flex flex-col gap-1 text-xs text-muted">{channel === "BANK" ? "Hangi bankadan" : "Hangi kasadan"}
        <select key={channel} name="account_id" required defaultValue={list[0]?.id ?? ""} className={input}>
          <option value="">— seçin —</option>
          {list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">Not<input name="note" className={`${input} w-40`} /></label>
      <button disabled={pending} className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">Avans ver</button>
      <Msg s={state} />
    </form>
  );
}
