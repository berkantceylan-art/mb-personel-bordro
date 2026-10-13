"use client";
import { useActionForm } from "@/lib/use-action-form";
import { useMemo, useRef, useState } from "react";
import { formatTL, parseTL } from "@mb/core";
import { savePayment } from "./actions";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";

export interface EmployeeOption {
  id: string;
  name: string;
  dept: string;
  cardNo: string | null;
  balance: number | null;
  accrued: number;
  advTotal: number;
  advCount: number;
  lastAdv: string | null;
}

const TYPES = [
  { v: "ADVANCE", l: "Avans" },
  { v: "SALARY", l: "Maaş" },
  { v: "BONUS", l: "Prim" },
  { v: "DEDUCTION", l: "Kesinti" },
];

const norm = (t: string) => t.toLocaleLowerCase("tr").replace(/[çğıöşüâ]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a" })[c] ?? c);
const initials = (n: string) => n.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]!.toLocaleUpperCase("tr")).join("");

export function PaymentForm({
  employees,
  departments,
  recentIds,
  defaultSelected,
  today,
  periods,
  accounts,
}: {
  employees: EmployeeOption[];
  departments: string[];
  recentIds: string[];
  defaultSelected: string[];
  today: string;
  periods: Array<{ value: string; label: string }>;
  accounts: Array<{ id: string; name: string; kind: "bank" | "cash" }>;
}) {
  const sig = useRef<SignaturePadHandle>(null);
  const isCashRef = useRef(false);
  const search = useRef<HTMLInputElement>(null);
  const { state, pending, formProps } = useActionForm(savePayment, {
    prepare: (fd) => fd.set("signature", isCashRef.current ? (sig.current?.toDataURL() ?? "") : ""),
    onSuccess: () => {
      sig.current?.clear();
      setSelected(new Set());
      setAmount("");
      search.current?.focus();
    },
  });
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelected));
  const [dept, setDept] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("ADVANCE");
  const [channel, setChannel] = useState<"CASH" | "BANK">("CASH");
  const [amount, setAmount] = useState("");
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const nq = norm(q.trim());
  const list = useMemo(
    () => employees.filter((e) => (!dept || e.dept === dept) && (!nq || norm(`${e.name} ${e.cardNo ?? ""} ${e.dept}`).includes(nq))),
    [employees, dept, nq],
  );
  const recent = recentIds.map((id) => byId.get(id)).filter((e): e is EmployeeOption => !!e && !selected.has(e.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const add = (id: string) => setSelected((s) => new Set(s).add(id));
  const chosen = [...selected].map((id) => byId.get(id)).filter((e): e is EmployeeOption => !!e);

  const hasChannel = type === "ADVANCE" || type === "SALARY";
  const isCash = hasChannel && channel === "CASH";
  const signable = isCash && selected.size === 1;
  isCashRef.current = signable;
  const accList = accounts.filter((a) => a.kind === (channel === "BANK" ? "bank" : "cash"));
  let amt = 0;
  let amtBad = false;
  try { amt = amount.trim() ? parseTL(amount) : 0; } catch { amtBad = true; }
  const over = hasChannel && amt > 0 ? chosen.filter((e) => e.balance !== null && amt > e.balance) : [];
  const seg = (on: boolean) => `flex-1 h-[52px] rounded-[10px] font-semibold ${on ? "bg-brand-700 text-white" : "border border-[#D5DEE8] bg-white text-[#33414F]"}`;
  const ctl = "h-[52px] rounded-[10px] border border-[#D5DEE8] px-3 text-base text-ink bg-white w-full";

  return (
    <form {...formProps} className="grid gap-5 xl:grid-cols-[1fr_440px] items-start">
      {[...selected].map((id) => <input key={id} type="hidden" name="employeeId" value={id} />)}
      <section className="bg-white border border-line rounded-2xl p-4 flex flex-col gap-3 min-w-0">
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden>🔍</span>
          <input
            ref={search}
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); if (list[0]) { add(list[0].id); setQ(""); } }
              if (e.key === "Escape") setQ("");
            }}
            placeholder="Ad, soyad, sicil ya da bölüm yazın · Enter ilkini seçer"
            aria-label="Personel ara"
            className="h-14 w-full rounded-[12px] border-2 border-brand-600/40 focus:border-brand-600 focus:outline-none pl-10 pr-3 text-lg"
          />
        </div>

        {recent.length > 0 && !q && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-muted mr-1">Son işlem yapılanlar:</span>
            {recent.map((e) => (
              <button type="button" key={e.id} onClick={() => add(e.id)} className="text-[13px] px-3 py-1.5 rounded-full bg-[#EEF4FB] text-brand-700 font-semibold">+ {e.name}</button>
            ))}
          </div>
        )}

        <div className="flex gap-1.5 flex-wrap items-center" role="group" aria-label="Bölüm filtresi">
          {["", ...departments].map((d) => (
            <button type="button" key={d || "all"} onClick={() => setDept(d)} className={`text-[13px] px-3 py-1.5 rounded-full ${dept === d ? "bg-brand-700 text-white font-semibold" : "bg-[#EEF2F6] text-[#33414F]"}`}>
              {d || "Tümü"}
            </button>
          ))}
          {(dept || nq) && list.length > 0 && (
            <button type="button" onClick={() => setSelected((s) => { const n = new Set(s); list.forEach((e) => n.add(e.id)); return n; })} className="text-[13px] px-3 py-1.5 rounded-full border border-brand-700 text-brand-700 font-semibold ml-auto">
              Görünen {list.length} kişiyi seç
            </button>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3 max-h-[60vh] overflow-auto pr-1">
          {list.map((e) => {
            const on = selected.has(e.id);
            return (
              <button type="button" key={e.id} onClick={() => toggle(e.id)} aria-pressed={on}
                className={`text-left flex gap-3 items-center px-3 py-2.5 rounded-xl min-h-16 transition-colors ${on ? "border-2 border-brand-700 bg-[#F0F6FD]" : "border border-line bg-white hover:border-brand-600/50"}`}>
                <span className={`w-10 h-10 rounded-full grid place-items-center text-sm font-bold shrink-0 ${on ? "bg-brand-700 text-white" : "bg-[#E8EEF5] text-brand-800"}`} aria-hidden>{on ? "✓" : initials(e.name)}</span>
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="font-semibold truncate">{e.name}</span>
                  <span className="text-xs text-muted truncate">{e.dept}{e.cardNo ? ` · ${e.cardNo}` : ""}</span>
                  {e.advCount > 0 && <span className="text-[11px] text-warn">bu ay {e.advCount} avans · {formatTL(e.advTotal)}</span>}
                </span>
                <span className="flex flex-col text-right shrink-0">
                  <span className="text-[11px] text-muted">Kalan</span>
                  <span className={`num font-semibold text-sm ${e.balance !== null && e.balance < 0 ? "text-bad" : ""}`}>{e.balance === null ? "—" : formatTL(e.balance)}</span>
                </span>
              </button>
            );
          })}
          {list.length === 0 && <p className="text-sm text-muted py-6 text-center sm:col-span-2">&quot;{q}&quot; ile eşleşen personel yok.</p>}
        </div>
      </section>

      <section className="bg-white border border-line rounded-2xl p-5 flex flex-col gap-4 xl:sticky xl:top-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between items-baseline">
            <span className="font-display font-semibold text-brand-800">{chosen.length ? `${chosen.length} personel seçili` : "Personel seçin"}</span>
            {chosen.length > 0 && <button type="button" onClick={() => setSelected(new Set())} className="text-xs font-semibold text-muted">Temizle</button>}
          </div>
          {chosen.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chosen.map((e) => (
                <span key={e.id} className="inline-flex items-center gap-1.5 pl-3 pr-1 py-1 rounded-full bg-[#EEF4FB] text-[13px] text-brand-800 font-semibold">
                  {e.name}
                  <button type="button" onClick={() => toggle(e.id)} aria-label={`${e.name} çıkar`} className="w-6 h-6 rounded-full hover:bg-white grid place-items-center">×</button>
                </span>
              ))}
            </div>
          )}
          {chosen.length === 1 && (
            <p className="text-xs text-muted">
              Hakediş {formatTL(chosen[0]!.accrued)} · kalan {chosen[0]!.balance === null ? "—" : formatTL(chosen[0]!.balance!)} · bu ay avans {formatTL(chosen[0]!.advTotal)}{chosen[0]!.lastAdv ? ` (son ${chosen[0]!.lastAdv.split("-").reverse().join(".")})` : ""}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-muted">Hareket türü</span>
          <div className="flex gap-1.5">{TYPES.map((t) => <button type="button" key={t.v} onClick={() => setType(t.v)} className={seg(type === t.v)}>{t.l}</button>)}</div>
          <input type="hidden" name="type" value={type} />
        </div>

        {hasChannel && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] text-muted">Kanal</span>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setChannel("CASH")} className={seg(channel === "CASH")}>Elden</button>
                <button type="button" onClick={() => setChannel("BANK")} className={seg(channel === "BANK")}>Banka</button>
              </div>
              <input type="hidden" name="channel" value={channel} />
            </div>
            <label className="flex flex-col gap-1.5 text-[13px] text-muted">
              {channel === "BANK" ? "Hangi bankadan" : "Hangi kasadan"}
              {accounts.length ? (
                <select key={channel} name="account_id" required defaultValue={accList[0]?.id ?? ""} className={ctl}>
                  <option value="">— seçin —</option>
                  {accList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              ) : (
                <span className="text-xs text-warn">Kasa / banka tanımlı değil; ödeme yalnız personel carisine yazılır.</span>
              )}
            </label>
          </div>
        )}

        <div className="grid gap-3 grid-cols-2">
          <label className="flex flex-col gap-1.5 text-[13px] text-muted">Tarih *<input type="date" name="date" required defaultValue={today} className={ctl} /></label>
          <label className="flex flex-col gap-1.5 text-[13px] text-muted">Dönem
            <select name="period" defaultValue={periods[0]?.value} className={ctl}>{periods.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] text-muted">
          Tutar (kişi başı) *
          <input name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} required inputMode="decimal" placeholder="10.000" className="num h-14 rounded-[10px] border-2 border-brand-700 px-3 text-2xl font-bold text-ink" />
          <span className={`text-xs min-h-4 ${amtBad ? "text-bad" : "text-muted"}`}>
            {amtBad ? "Tutar okunamadı · örnek: 5.000 veya 5.000,50" : amt ? `= ${formatTL(amt)}${chosen.length > 1 ? ` × ${chosen.length} kişi = ${formatTL(amt * chosen.length)}` : ""}` : ""}
          </span>
        </label>
        {over.length > 0 && (
          <p className="text-xs rounded-lg px-3 py-2 bg-warn-bg text-warn">Kalan bakiyeyi aşıyor: {over.map((e) => `${e.name} (kalan ${formatTL(e.balance ?? 0)})`).join(", ")}. Kaydedilebilir; fazlası sonraki aydan düşer.</p>
        )}
        <label className="flex flex-col gap-1.5 text-[13px] text-muted">Açıklama<input name="note" placeholder="İsteğe bağlı not" className="h-12 rounded-[10px] border border-[#D5DEE8] px-3 text-ink" /></label>

        {isCash && selected.size > 1 && <p className="text-xs text-muted">Birden çok kişi seçili: imza alınmaz. İmzalı makbuz için kişileri tek tek kaydedin.</p>}
        {signable && (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="font-semibold">Personel imzası</span>
              <button type="button" onClick={() => sig.current?.clear()} className="h-9 px-3 rounded-lg border border-[#D5DEE8] text-[13px]">Temizle</button>
            </div>
            <SignaturePad ref={sig} />
          </div>
        )}

        {state && (
          <p role="status" className={`text-sm rounded-lg px-3 py-2 flex flex-wrap items-center gap-3 ${state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>
            {state.message}
            {state.ok && state.printIds && state.printIds.length > 0 && (
              <a href={`/yazdir/avans?ids=${state.printIds.join(",")}`} target="_blank" rel="noopener" className="ml-auto h-9 px-3 inline-flex items-center rounded-lg bg-brand-700 text-white font-semibold">
                Makbuz yazdır{state.printIds.length > 1 ? ` (${state.printIds.length})` : ""}
              </a>
            )}
          </p>
        )}

        <button disabled={pending || selected.size === 0 || amtBad || !amt} className="h-14 rounded-xl bg-brand-700 text-white font-bold text-lg disabled:opacity-50">
          {pending ? "Kaydediliyor…" : selected.size ? `Kaydet · ${selected.size} kişi${amt ? ` · ${formatTL(amt * selected.size)}` : ""}` : "Önce personel seçin"}
        </button>
      </section>
    </form>
  );
}
