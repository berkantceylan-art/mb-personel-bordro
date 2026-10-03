"use client";
import { useActionState, useMemo, useState } from "react";
import { applyRaise, formatTL, raisePercent, tl, type RaiseKind } from "@mb/core";
import { applyBulkRaise, type RaiseResult } from "./actions";

export interface RaiseEmployee {
  id: string;
  name: string;
  dept: string;
  current: number | null; // kuruş
}

export function BulkRaiseForm({ employees, departments, defaultDate }: { employees: RaiseEmployee[]; departments: string[]; defaultDate: string }) {
  const [state, action, pending] = useActionState<RaiseResult | null, FormData>(applyBulkRaise, null);
  const [depts, setDepts] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<RaiseKind>("PERCENT");
  const [value, setValue] = useState("");
  const [roundTo, setRoundTo] = useState("0");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const ruleValue = useMemo(() => {
    const v = Number(value.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) return null;
    return kind === "PERCENT" ? Number(value.replace(",", ".")) : tl(v);
  }, [value, kind]);

  const scoped = employees.filter((e) => e.current !== null && (depts.size === 0 || depts.has(e.dept)));
  const rows = scoped.map((e) => {
    const next = ruleValue === null ? e.current! : applyRaise(e.current!, { kind, value: ruleValue, roundTo: Number(roundTo) * 100 });
    return { ...e, next, on: !excluded.has(e.id) };
  });
  const selected = rows.filter((r) => r.on);
  const before = selected.reduce((a, r) => a + r.current!, 0);
  const after = selected.reduce((a, r) => a + r.next, 0);

  const toggleDept = (d: string) => setDepts((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; });
  const toggleEmp = (id: string) => setExcluded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const seg = (on: boolean) => `h-11 px-4 rounded-[10px] font-semibold ${on ? "bg-brand-700 text-white" : "border border-[#D5DEE8] bg-white text-[#33414F]"}`;
  const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white";

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="scope" value={depts.size ? [...depts].join(", ") : "Tüm personel"} />
      <section className="bg-white border border-line rounded-2xl p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-muted">Kapsam (seçilmezse tüm personel)</span>
          <div className="flex flex-wrap gap-1.5">
            {departments.map((d) => (
              <button type="button" key={d} onClick={() => toggleDept(d)} className={`text-[13px] px-3 py-1.5 rounded-full ${depts.has(d) ? "bg-brand-700 text-white font-semibold" : "bg-[#EEF2F6] text-[#33414F]"}`}>{d}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-muted">Zam türü</span>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setKind("PERCENT")} className={seg(kind === "PERCENT")}>Yüzde</button>
              <button type="button" onClick={() => setKind("AMOUNT")} className={seg(kind === "AMOUNT")}>Tutar (TL)</button>
            </div>
          </div>
          <label className="flex flex-col gap-1.5 text-sm text-muted">{kind === "PERCENT" ? "Oran (%)" : "Artış (TL)"}
            <input name="value" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder={kind === "PERCENT" ? "ör. 25" : "ör. 5.000"} className={`${input} num w-36 font-bold`} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Yuvarlama
            <select name="roundTo" value={roundTo} onChange={(e) => setRoundTo(e.target.value)} className={input}>
              <option value="0">Yok</option><option value="100">100 TL</option><option value="500">500 TL</option><option value="1000">1.000 TL</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Geçerlilik tarihi
            <input type="date" name="effective_date" defaultValue={defaultDate} required className={input} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-muted flex-1 min-w-56">Açıklama
            <input name="note" placeholder="ör. 2027 Ocak genel zammı" className={input} />
          </label>
        </div>
      </section>

      <section className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        {[
          ["Zam alacak personel", String(selected.length)],
          ["Mevcut aylık toplam", formatTL(before)],
          ["Zam sonrası aylık toplam", formatTL(after)],
          ["Aylık maliyet artışı", `${formatTL(after - before)} (%${raisePercent(before, after)})`],
        ].map(([l, v]) => (
          <div key={l} className="bg-white border border-line rounded-[14px] px-5 py-4 flex flex-col gap-1">
            <span className="text-[13px] text-muted">{l}</span>
            <span className="num font-display text-xl font-bold text-brand-800">{v}</span>
          </div>
        ))}
      </section>

      <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-3 px-4 border-b border-line w-10"><span className="sr-only">Seç</span></th>
              <th className="py-3 px-4 font-semibold border-b border-line">Personel</th>
              <th className="py-3 px-4 font-semibold border-b border-line">Bölüm</th>
              <th className="py-3 px-4 font-semibold border-b border-line text-right">Mevcut</th>
              <th className="py-3 px-4 font-semibold border-b border-line text-right">Yeni</th>
              <th className="py-3 px-4 font-semibold border-b border-line text-right">Fark</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.on ? "" : "opacity-50"}>
                <td className="py-2.5 px-4 border-b border-[#EEF2F6]">
                  <input type="checkbox" name={r.on ? "employeeId" : undefined} value={r.id} checked={r.on} onChange={() => toggleEmp(r.id)} aria-label={`${r.name} zam alsın`} className="w-5 h-5 accent-[#0A3D73]" />
                </td>
                <td className="py-2.5 px-4 border-b border-[#EEF2F6] font-semibold">{r.name}</td>
                <td className="py-2.5 px-4 border-b border-[#EEF2F6]">{r.dept}</td>
                <td className="num py-2.5 px-4 border-b border-[#EEF2F6] text-right">{formatTL(r.current!)}</td>
                <td className="num py-2.5 px-4 border-b border-[#EEF2F6] text-right font-semibold">{formatTL(r.next)}</td>
                <td className="num py-2.5 px-4 border-b border-[#EEF2F6] text-right text-ok">+{formatTL(r.next - r.current!)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted">Kapsamda ücret kaydı olan personel yok.</td></tr>}
          </tbody>
        </table>
      </section>

      {state && <p role="status" className={`text-sm rounded-lg px-3 py-2 ${state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{state.message}</p>}
      <div className="sticky bottom-0 bg-ground py-3">
        <button disabled={pending || ruleValue === null || selected.length === 0} className="h-12 px-6 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-50">
          {pending ? "Uygulanıyor…" : `Zammı ${selected.length} personele uygula`}
        </button>
      </div>
    </form>
  );
}
