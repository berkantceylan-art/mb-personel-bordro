"use client";
import { useActionState, useMemo, useRef, useState } from "react";
import { formatTL } from "@mb/core";
import { savePayment, type SaveResult } from "./actions";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";

export interface EmployeeOption {
  id: string;
  name: string;
  dept: string;
  cardNo: string | null;
  balance: number | null;
}

const TYPES = [
  { v: "ADVANCE", l: "Avans" },
  { v: "SALARY", l: "Maaş" },
  { v: "BONUS", l: "Prim" },
  { v: "DEDUCTION", l: "Kesinti" },
];

export function PaymentForm({
  employees,
  departments,
  defaultSelected,
  today,
  periods,
}: {
  employees: EmployeeOption[];
  departments: string[];
  defaultSelected: string[];
  today: string;
  periods: Array<{ value: string; label: string }>;
}) {
  const [state, action, pending] = useActionState<SaveResult | null, FormData>(savePayment, null);
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelected));
  const [dept, setDept] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("ADVANCE");
  const [channel, setChannel] = useState("CASH");
  const sig = useRef<SignaturePadHandle>(null);
  const [signature, setSignature] = useState("");

  const list = useMemo(
    () =>
      employees.filter(
        (e) =>
          (!dept || e.dept === dept) &&
          (!q || `${e.name} ${e.cardNo ?? ""}`.toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr"))),
      ),
    [employees, dept, q],
  );
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const hasChannel = type === "ADVANCE" || type === "SALARY";
  const isCash = hasChannel && channel === "CASH";
  const seg = (on: boolean) =>
    `flex-1 h-[52px] rounded-[10px] font-semibold ${on ? "bg-brand-700 text-white" : "border border-[#D5DEE8] bg-white text-[#33414F]"}`;

  return (
    <form
      action={(fd) => {
        fd.set("signature", isCash ? (sig.current?.toDataURL() ?? signature) : "");
        return action(fd);
      }}
      className="grid gap-5 lg:grid-cols-[360px_1fr]"
    >
      <section className="bg-white border border-line rounded-2xl p-4 flex flex-col gap-3 lg:max-h-[calc(100vh-140px)]">
        <div className="flex justify-between items-baseline">
          <h2 className="font-display font-semibold text-brand-800">Personel</h2>
          <span className="text-[13px] text-muted">{selected.size} seçili</span>
        </div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad veya sicil ara" aria-label="Personel ara" className="h-12 rounded-[10px] border border-[#D5DEE8] px-3.5" />
        <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Bölüm filtresi">
          {["", ...departments].map((d) => (
            <button type="button" key={d || "all"} onClick={() => setDept(d)} className={`text-[13px] px-3 py-1.5 rounded-full ${dept === d ? "bg-brand-700 text-white font-semibold" : "bg-[#EEF2F6] text-[#33414F]"}`}>
              {d || "Tümü"}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 overflow-auto">
          {list.map((e) => {
            const on = selected.has(e.id);
            return (
              <label key={e.id} className={`flex gap-3 items-center px-3 py-2.5 rounded-xl cursor-pointer min-h-14 ${on ? "border-2 border-brand-700 bg-[#F5F9FD]" : "border border-line bg-white"}`}>
                <input type="checkbox" name="employeeId" value={e.id} checked={on} onChange={() => toggle(e.id)} className="w-5 h-5 accent-[#0A3D73]" />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="font-semibold">{e.name}</span>
                  <span className="text-xs text-muted">{e.dept} · {e.cardNo ?? "sicil yok"}</span>
                </span>
                <span className="flex flex-col text-right">
                  <span className="text-[11px] text-muted">Kalan</span>
                  <span className="num font-semibold">{e.balance === null ? "—" : formatTL(e.balance)}</span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="bg-white border border-line rounded-2xl p-5 flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-muted">Hareket türü</span>
            <div className="flex gap-1.5">
              {TYPES.map((t) => (
                <button type="button" key={t.v} onClick={() => setType(t.v)} className={seg(type === t.v)}>{t.l}</button>
              ))}
            </div>
            <input type="hidden" name="type" value={type} />
          </div>
          {hasChannel && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] text-muted">Kanal</span>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setChannel("CASH")} className={seg(channel === "CASH")}>Elden</button>
                <button type="button" onClick={() => setChannel("BANK")} className={seg(channel === "BANK")}>Banka</button>
              </div>
              <input type="hidden" name="channel" value={channel} />
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-[13px] text-muted">
            Tarih *
            <input type="date" name="date" required defaultValue={today} className="h-[52px] rounded-[10px] border border-[#D5DEE8] px-3 text-base text-ink" />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] text-muted">
            Dönem
            <select name="period" defaultValue={periods[0]?.value} className="h-[52px] rounded-[10px] border border-[#D5DEE8] px-3 text-base text-ink bg-white">
              {periods.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] text-muted">
            Tutar (kişi başı) *
            <input name="amount" required inputMode="decimal" placeholder="10.000,00" className="num h-[52px] rounded-[10px] border-2 border-brand-700 px-3 text-xl font-bold text-ink" />
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] text-muted">
          Açıklama
          <input name="note" placeholder="İsteğe bağlı not" className="h-12 rounded-[10px] border border-[#D5DEE8] px-3 text-ink" />
        </label>

        {isCash && (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="font-semibold">Personel imzası</span>
              <button type="button" onClick={() => { sig.current?.clear(); setSignature(""); }} className="h-9 px-3 rounded-lg border border-[#D5DEE8] text-[13px]">Temizle</button>
            </div>
            <SignaturePad ref={sig} onChange={setSignature} />
            <span className="text-xs text-muted">Parmakla veya fareyle imzalayın. Tek kişi seçiliyken alınması önerilir.</span>
          </div>
        )}

        {state && (
          <p role="status" className={`text-sm rounded-lg px-3 py-2 ${state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{state.message}</p>
        )}

        <div className="flex justify-end gap-3 mt-auto">
          <button disabled={pending || selected.size === 0} className="h-14 px-6 rounded-xl bg-brand-700 text-white font-bold disabled:opacity-50">
            {pending ? "Kaydediliyor…" : `Kaydet (${selected.size} kişi)`}
          </button>
        </div>
      </section>
    </form>
  );
}
