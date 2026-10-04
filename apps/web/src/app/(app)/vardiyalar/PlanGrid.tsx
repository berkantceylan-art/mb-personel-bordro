"use client";
import { useMemo, useState, useTransition } from "react";
import { savePlan } from "./actions";

export interface PlanShift {
  id: string;
  code: string;
  name: string;
  color: string;
  hours: string;
  weekdays: number[];
}
export interface PlanEmployee {
  id: string;
  name: string;
  dept: string;
  defaultShiftId: string | null;
}

const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const OFF = { bg: "#EEF2F6", fg: "#5A6878" };
const textOn = (bg: string) => (bg === "#1E3550" ? "#FFFFFF" : "#0A2540");

export function PlanGrid({
  dates,
  employees,
  shifts,
  initial,
}: {
  dates: string[];
  employees: PlanEmployee[];
  shifts: PlanShift[];
  initial: Record<string, string>; // "empId|date" → shiftId | "OFF"
}) {
  const [brush, setBrush] = useState<string>(shifts[0]?.id ?? "OFF");
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);

  const cellValue = (empId: string, date: string, idx: number, def: string | null) => {
    const k = `${empId}|${date}`;
    const v = k in changes ? changes[k]! : initial[k];
    if (v !== undefined && v !== "") return { v, explicit: true };
    if (def) {
      const s = byId.get(def);
      if (s) return { v: s.weekdays.includes(idx + 1) ? def : "OFF", explicit: false };
    }
    return { v: idx === 6 ? "OFF" : "", explicit: false };
  };

  const paint = (empId: string, date: string) => {
    const k = `${empId}|${date}`;
    setChanges((c) => ({ ...c, [k]: brush === "DEFAULT" ? "" : brush }));
  };
  const paintRow = (empId: string) => setChanges((c) => ({ ...c, ...Object.fromEntries(dates.map((d) => [`${empId}|${d}`, brush === "DEFAULT" ? "" : brush])) }));

  const save = () =>
    start(async () => {
      const list = Object.entries(changes).map(([k, value]) => {
        const [employeeId, date] = k.split("|") as [string, string];
        return { employeeId, date, value };
      });
      const r = await savePlan(list);
      setMsg(r.message);
      setChanges({});
    });

  const brushes = [...shifts.map((s) => ({ id: s.id, label: `${s.code} · ${s.name}`, sub: s.hours, bg: s.color })), { id: "OFF", label: "HT · Hafta tatili", sub: "", bg: OFF.bg }, { id: "DEFAULT", label: "Varsayılana dön", sub: "", bg: "#FFFFFF" }];
  let lastDept = "";
  const count = Object.keys(changes).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-line rounded-2xl p-4 flex flex-col gap-2">
        <span className="text-sm text-muted">Fırça: seçip hücrelere tıklayın, ismin yanındaki ⇥ ile tüm haftayı boyayın</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Vardiya fırçası">
          {brushes.map((b) => (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={brush === b.id}
              onClick={() => setBrush(b.id)}
              className={`h-11 px-3 rounded-[10px] text-sm font-semibold flex items-center gap-2 ${brush === b.id ? "ring-2 ring-brand-700 ring-offset-1" : "border border-[#D5DEE8]"}`}
              style={{ background: b.bg, color: textOn(b.bg) }}
            >
              {b.label}
              {b.sub && <span className="font-normal text-xs opacity-80">{b.sub}</span>}
            </button>
          ))}
        </div>
      </div>

      <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
        <table className="w-full text-[13px] min-w-[860px]">
          <thead>
            <tr>
              <th className="text-left py-3 px-4 font-semibold text-muted border-b border-line w-56">Personel</th>
              {dates.map((d, i) => (
                <th key={d} className={`py-3 px-1 font-semibold border-b border-line text-center ${i >= 5 ? "text-warn" : "text-[#33414F]"}`}>
                  <span className="block">{DAYS[i]}</span>
                  <span className="num font-normal text-xs">{d.slice(8, 10)}.{d.slice(5, 7)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const header = e.dept !== lastDept;
              lastDept = e.dept;
              return [
                header && (
                  <tr key={`h-${e.dept}`}><td colSpan={8} className="py-2 px-4 bg-[#F3F6F9] text-xs font-bold uppercase tracking-wider text-[#33414F]">{e.dept}</td></tr>
                ),
                <tr key={e.id}>
                  <td className="py-1.5 px-4 border-b border-[#EEF2F6]">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold flex-1 truncate">{e.name}</span>
                      <button type="button" onClick={() => paintRow(e.id)} aria-label={`${e.name} için tüm haftayı boya`} className="w-8 h-8 rounded-md border border-[#D5DEE8] text-muted">⇥</button>
                    </div>
                  </td>
                  {dates.map((d, i) => {
                    const { v, explicit } = cellValue(e.id, d, i, e.defaultShiftId);
                    const s = v && v !== "OFF" ? byId.get(v) : undefined;
                    const bg = s ? s.color : v === "OFF" ? OFF.bg : "#FFFFFF";
                    const changed = `${e.id}|${d}` in changes;
                    return (
                      <td key={d} className="py-1 px-1 border-b border-[#EEF2F6]">
                        <button
                          type="button"
                          onClick={() => paint(e.id, d)}
                          aria-label={`${e.name} ${d}: ${s ? s.name : v === "OFF" ? "hafta tatili" : "atanmamış"}`}
                          className={`w-full h-11 rounded-lg flex flex-col items-center justify-center leading-tight ${explicit ? "" : "opacity-60 border border-dashed border-[#C5D0DC]"} ${changed ? "ring-2 ring-accent" : ""}`}
                          style={{ background: bg, color: s ? textOn(s.color) : OFF.fg }}
                        >
                          <b>{s ? s.code : v === "OFF" ? "HT" : "—"}</b>
                          {s && <span className="num text-[10px]">{s.hours}</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </section>

      <div className="sticky-save bg-ground py-3 border-t border-line md:border-0 flex items-center gap-4">
        <button type="button" onClick={save} disabled={pending || count === 0} className="h-12 px-6 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-50">
          {pending ? "Kaydediliyor…" : `Planı kaydet${count ? ` (${count})` : ""}`}
        </button>
        {count > 0 && <button type="button" onClick={() => setChanges({})} className="text-sm font-semibold text-muted">Değişiklikleri geri al</button>}
        {msg && <span role="status" className="text-sm text-ok">{msg}</span>}
        <span className="text-xs text-muted ml-auto">Kesik çizgili hücreler varsayılan vardiyadan geliyor.</span>
      </div>
    </div>
  );
}
