"use client";
import { useMemo, useState } from "react";
import { formatTL, parseTL } from "@mb/core";
import { useActionForm } from "@/lib/use-action-form";
import { bankPostPayroll } from "@/lib/salary-plan-actions";

export interface Cand { label: string; items: Array<{ id: string; amount: number; type: "SALARY" | "ADVANCE" }> }
type Person = { id: string; name: string; dept: string; leftBank: number };
type Pick = { amount: string; type: "SALARY" | "ADVANCE" };

const num = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const safe = (v: string) => { try { return v.trim() ? parseTL(v) : 0; } catch { return NaN; } };

export function MatchRow({ period, closed, line, candidates, people }: {
  period: string; closed: boolean;
  line: { id: string; date: string; description: string; amount: number; account: string; reason: string | null };
  candidates: Cand[]; people: Person[];
}) {
  const { state, pending, formProps } = useActionForm(bankPostPayroll);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const apply = (c: Cand) => { setPicks(Object.fromEntries(c.items.map((i) => [i.id, { amount: num.format(i.amount / 100), type: i.type }]))); setOpen(true); };
  const sum = Object.values(picks).reduce((a, p) => a + (safe(p.amount) || 0), 0);
  const bad = Object.values(picks).some((p) => Number.isNaN(safe(p.amount)));
  const diff = line.amount - sum;
  const items = JSON.stringify(Object.entries(picks).map(([employee_id, p]) => ({ employee_id, amount: p.amount, type: p.type })));
  const nq = q.toLocaleLowerCase("tr").trim();
  const list = useMemo(() => people.filter((p) => !nq || p.name.toLocaleLowerCase("tr").includes(nq)).sort((a, b) => Number(!!picks[b.id]) - Number(!!picks[a.id]) || b.leftBank - a.leftBank), [people, nq, picks]);
  const toggle = (p: Person) => setPicks((c) => {
    const n = { ...c };
    if (n[p.id]) delete n[p.id];
    else n[p.id] = { amount: num.format(Math.min(p.leftBank || line.amount, Math.max(0, line.amount - sum)) / 100), type: "SALARY" };
    return n;
  });

  if (state?.ok) return <li className="rounded-[12px] border border-ok/40 bg-ok-bg p-3 text-sm text-ok">{line.date} · {formatTL(line.amount)} — {state.message}</li>;
  return (
    <li className="rounded-[12px] border border-line p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="num text-muted text-sm">{line.date}</span>
        <span className="flex-1 min-w-[200px] font-semibold text-sm">{line.description || "(açıklama yok)"}<span className="block text-xs text-muted font-normal">{line.account}{line.reason ? ` · ${line.reason}` : ""}</span></span>
        <span className="num font-bold text-brand-800">{formatTL(line.amount)}</span>
      </div>
      {!closed && (
        <div className="flex flex-wrap gap-2">
          {candidates.map((c) => (
            <button type="button" key={c.label} onClick={() => apply(c)} className="text-[13px] px-3 py-1.5 rounded-full bg-[#E7F1FB] text-brand-700 font-semibold">✨ {c.label}</button>
          ))}
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-[13px] px-3 py-1.5 rounded-full border border-[#D5DEE8] text-[#33414F] font-semibold">{open ? "Kapat" : "Personel seçerek dağıt"}</button>
        </div>
      )}
      {open && !closed && (
        <form {...formProps} className="flex flex-col gap-2 border-t border-line pt-2">
          <input type="hidden" name="line" value={line.id} />
          <input type="hidden" name="period" value={period} />
          <input type="hidden" name="items" value={items} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Personel ara" aria-label="Personel ara" className="h-10 rounded-lg border border-[#D5DEE8] px-3 max-w-xs" />
          <div className="max-h-72 overflow-auto flex flex-col">
            {list.map((p) => {
              const on = !!picks[p.id];
              return (
                <div key={p.id} className={`flex flex-wrap items-center gap-2 px-2 py-1.5 rounded-lg ${on ? "bg-[#F0F6FD]" : ""}`}>
                  <label className="flex items-center gap-2 flex-1 min-w-[180px] cursor-pointer">
                    <input type="checkbox" checked={on} onChange={() => toggle(p)} className="w-5 h-5 accent-[#0A3D73]" />
                    <span className="text-sm font-semibold">{p.name}</span>
                    <span className="text-xs text-muted">{p.dept} · bankaya kalan {formatTL(p.leftBank)}</span>
                  </label>
                  {on && (
                    <>
                      <input value={picks[p.id]!.amount} onChange={(e) => setPicks((c) => ({ ...c, [p.id]: { ...c[p.id]!, amount: e.target.value } }))} inputMode="decimal" aria-label={`${p.name} tutar`} className="num h-9 w-32 rounded-lg border border-[#D5DEE8] px-2 text-right" />
                      <select value={picks[p.id]!.type} onChange={(e) => setPicks((c) => ({ ...c, [p.id]: { ...c[p.id]!, type: e.target.value as Pick["type"] } }))} aria-label="Tür" className="h-9 rounded-lg border border-[#D5DEE8] bg-white px-2 text-sm">
                        <option value="SALARY">Maaş</option>
                        <option value="ADVANCE">Avans</option>
                      </select>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">Dağıtılan <b className="num">{formatTL(sum)}</b> / {formatTL(line.amount)}{diff !== 0 && !bad ? <span className={`ml-2 font-semibold ${diff > 0 ? "text-warn" : "text-bad"}`}>{diff > 0 ? `${formatTL(diff)} eksik` : `${formatTL(-diff)} fazla`}</span> : null}</span>
            <button disabled={pending || bad || diff !== 0 || sum === 0} className="h-11 px-5 rounded-xl bg-brand-700 text-white font-bold disabled:opacity-40 ml-auto">{pending ? "Kaydediliyor…" : `Eşleştir ve işle (${Object.keys(picks).length} kişi)`}</button>
          </div>
          {state && !state.ok && <p role="status" className="text-sm rounded-lg px-3 py-2 bg-bad-bg text-bad">{state.message}</p>}
        </form>
      )}
    </li>
  );
}
