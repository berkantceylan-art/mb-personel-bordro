"use client";
import { useActionState, useState } from "react";
import { applyRaise, formatTL, raisePercent, tl, type RaiseKind } from "@mb/core";
import { applyEmployeeRaise } from "../../../zamlar/actions";

export function EmployeeRaiseForm(props: {
  employeeId: string;
  current: number | null;
  insuranceType: string;
  fixedOfficialNet: string;
  bes: boolean;
  defaultDate: string;
}) {
  const [state, action, pending] = useActionState(applyEmployeeRaise, null);
  const [kind, setKind] = useState<RaiseKind>(props.current ? "PERCENT" : "SET");
  const [value, setValue] = useState("");
  const [insurance, setInsurance] = useState(props.insuranceType);
  const cleaned = kind === "PERCENT" ? value.replace(",", ".") : value.replace(/\./g, "").replace(",", ".");
  const v = Number(cleaned);
  const next = Number.isFinite(v) && v > 0 ? applyRaise(props.current ?? 0, { kind, value: kind === "PERCENT" ? v : tl(v) }) : null;
  const seg = (on: boolean) => `h-11 px-4 rounded-[10px] font-semibold ${on ? "bg-brand-700 text-white" : "border border-[#D5DEE8] bg-white text-[#33414F]"}`;
  const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white";

  return (
    <form action={action} className="bg-white border border-line rounded-2xl p-6 flex flex-col gap-4">
      <input type="hidden" name="employeeId" value={props.employeeId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-wrap gap-1.5">
        {props.current !== null && <button type="button" onClick={() => setKind("PERCENT")} className={seg(kind === "PERCENT")}>Yüzde zam</button>}
        {props.current !== null && <button type="button" onClick={() => setKind("AMOUNT")} className={seg(kind === "AMOUNT")}>Tutar zam</button>}
        <button type="button" onClick={() => setKind("SET")} className={seg(kind === "SET")}>Yeni ücret gir</button>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm text-muted">{kind === "PERCENT" ? "Oran (%)" : kind === "AMOUNT" ? "Artış (TL)" : "Yeni aylık toplam net (TL)"}
          <input name="value" value={value} onChange={(e) => setValue(e.target.value)} required inputMode="decimal" className={`${input} num font-bold text-lg`} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Geçerlilik tarihi
          <input type="date" name="effective_date" required defaultValue={props.defaultDate} className={input} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Açıklama
          <input name="reason" placeholder="ör. Performans zammı" className={input} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">Sigorta
          <select name="insurance_type" value={insurance} onChange={(e) => setInsurance(e.target.value)} className={input}>
            <option value="MIN_WAGE">Asgari ücretten</option>
            <option value="FIXED_NET">Belirli net üzerinden</option>
          </select>
        </label>
        {insurance === "FIXED_NET" && (
          <label className="flex flex-col gap-1.5 text-sm text-muted">Resmi net (bankaya)
            <input name="fixed_official_net" defaultValue={props.fixedOfficialNet} required inputMode="decimal" className={`${input} num`} />
          </label>
        )}
        <label className="flex gap-2.5 items-center text-sm self-end h-11"><input type="checkbox" name="bes" defaultChecked={props.bes} className="w-5 h-5" />Otomatik katılım BES (%3)</label>
      </div>
      <p className="text-sm bg-[#F3F6F9] rounded-lg px-3 py-2">
        Mevcut: <b className="num">{props.current === null ? "—" : formatTL(props.current)}</b>
        {next !== null && <> → Yeni: <b className="num text-brand-700">{formatTL(next)}</b>{props.current ? <> (%{raisePercent(props.current, next).toLocaleString("tr-TR")})</> : null}</>}
      </p>
      {state && <p role="status" className="text-sm rounded-lg px-3 py-2 bg-bad-bg text-bad">{state.message}</p>}
      <button disabled={pending} className="h-12 px-6 rounded-[10px] bg-brand-700 text-white font-semibold self-start disabled:opacity-60">{pending ? "Kaydediliyor…" : "Kaydet"}</button>
    </form>
  );
}
