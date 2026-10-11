"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createLoan } from "@/lib/fin2-actions";
import { CURRENCIES, fmt, parseAmount } from "@/lib/fin";
import { addMonths, schedule, type Inst } from "@/lib/loan";
import { Field, Notice, btnPrimary, inputCls, selectCls } from "@/components/erp";

const num = (s: string) => Number(String(s).replace(",", ".")) || 0;

/** Yeni kredi: ödeme planı hesaplanır, satırlar bankanın tablosuna göre düzeltilebilir */
export function LoanForm({ banks, today }: { banks: { id: string; name: string; currency: string }[]; today: string }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", bank_name: "", loan_no: "", principal: "", currency: "TRY", annual_rate: "", tax_pct: "5", term: "12", method: "annuity", start: today, first: addMonths(today, 1), account: banks[0]?.id ?? "", existing: false, note: "" });
  const [edits, setEdits] = useState<Record<number, Partial<Inst>>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = useMemo(() => {
    const p = parseAmount(f.principal) ?? 0;
    if (!p || f.method === "manual") return [] as Inst[];
    return schedule({ principal: p, annualRate: num(f.annual_rate), taxPct: num(f.tax_pct), term: Number(f.term) || 1, firstDue: f.first, method: f.method as "annuity" | "equal_principal" });
  }, [f.principal, f.annual_rate, f.tax_pct, f.term, f.first, f.method]);
  const rows = base.map((r) => ({ ...r, ...edits[r.no] }));
  const tot = rows.reduce((t, r) => ({ p: t.p + r.principal, i: t.i + r.interest, x: t.x + r.tax }), { p: 0, i: 0, x: 0 });
  const set = (k: keyof typeof f, v: string | boolean) => { setF({ ...f, [k]: v }); if (["principal", "annual_rate", "tax_pct", "term", "first", "method"].includes(k)) setEdits({}); };

  async function save() {
    setBusy(true); setMsg(null);
    const res = await createLoan({
      name: f.name || `Kredi · ${f.bank_name}`, bank_name: f.bank_name, loan_no: f.loan_no, principal: f.existing ? tot.p : parseAmount(f.principal) ?? 0, currency: f.currency,
      annual_rate: num(f.annual_rate), tax_pct: num(f.tax_pct), method: f.method, start_date: f.start, disbursed_account_id: f.existing ? null : f.account, existing: f.existing, note: f.note, schedule: rows,
    });
    setBusy(false);
    if (res.ok && res.id) router.push(`/finans/krediler/${res.id}?tamam=${encodeURIComponent(res.message)}`);
    else setMsg(res.message);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Banka"><input value={f.bank_name} onChange={(e) => set("bank_name", e.target.value)} className={inputCls} /></Field>
        <Field label="Kredi no"><input value={f.loan_no} onChange={(e) => set("loan_no", e.target.value)} className={inputCls} /></Field>
        <Field label="Ad" hint="isteğe bağlı" className="md:col-span-2"><input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="ör. Cihaz kredisi" className={inputCls} /></Field>
        <Field label="Anapara"><input value={f.principal} onChange={(e) => set("principal", e.target.value)} inputMode="decimal" className={inputCls} /></Field>
        <Field label="Para birimi"><select value={f.currency} onChange={(e) => set("currency", e.target.value)} className={selectCls}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Yıllık faiz %"><input value={f.annual_rate} onChange={(e) => set("annual_rate", e.target.value)} inputMode="decimal" placeholder="ör. 42" className={inputCls} /></Field>
        <Field label="BSMV / KKDF %" hint="faiz üzerinden"><input value={f.tax_pct} onChange={(e) => set("tax_pct", e.target.value)} inputMode="decimal" className={inputCls} /></Field>
        <Field label="Vade (ay)"><input value={f.term} onChange={(e) => set("term", e.target.value)} inputMode="numeric" className={inputCls} /></Field>
        <Field label="Yöntem"><select value={f.method} onChange={(e) => set("method", e.target.value)} className={selectCls}><option value="annuity">Eşit taksit</option><option value="equal_principal">Eşit anapara</option></select></Field>
        <Field label="Kullanım tarihi"><input type="date" value={f.start} onChange={(e) => set("start", e.target.value)} className={inputCls} /></Field>
        <Field label="İlk taksit"><input type="date" value={f.first} onChange={(e) => set("first", e.target.value)} className={inputCls} /></Field>
        <label className="md:col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.existing} onChange={(e) => set("existing", e.target.checked)} /> Devam eden kredi (yalnız kalan taksitleri girin; kullanım kaydı atılmaz)</label>
        {!f.existing && (
          <Field label="Yatan hesap" className="md:col-span-2"><select value={f.account} onChange={(e) => set("account", e.target.value)} className={selectCls}>{banks.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}</select></Field>
        )}
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto bg-white border border-line rounded-[14px]">
          <table className="w-full text-sm min-w-[640px]">
            <thead><tr className="text-xs text-muted text-left"><th className="px-3 py-2">#</th><th className="px-2 py-2">Vade</th><th className="px-2 py-2 text-right">Anapara</th><th className="px-2 py-2 text-right">Faiz</th><th className="px-2 py-2 text-right">BSMV/KKDF</th><th className="px-3 py-2 text-right">Taksit</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.no} className="border-t border-[#EEF2F6]">
                  <td className="px-3 py-1.5 text-muted">{r.no}</td>
                  <td className="px-2 py-1.5"><input type="date" value={r.due_date} onChange={(e) => setEdits({ ...edits, [r.no]: { ...edits[r.no], due_date: e.target.value } })} className={`${inputCls} h-8`} /></td>
                  {(["principal", "interest", "tax"] as const).map((k) => (
                    <td key={k} className="px-2 py-1.5"><input key={`${k}${r[k]}`} defaultValue={(r[k] / 100).toFixed(2).replace(".", ",")} onBlur={(e) => setEdits({ ...edits, [r.no]: { ...edits[r.no], [k]: parseAmount(e.target.value) ?? 0 } })} inputMode="decimal" className={`${inputCls} h-8 text-right`} /></td>
                  ))}
                  <td className="px-3 py-1.5 text-right num font-semibold">{fmt(r.principal + r.interest + r.tax, f.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-line font-semibold"><td className="px-3 py-2" colSpan={2}>Toplam</td><td className="px-2 py-2 text-right num">{fmt(tot.p, f.currency)}</td><td className="px-2 py-2 text-right num">{fmt(tot.i, f.currency)}</td><td className="px-2 py-2 text-right num">{fmt(tot.x, f.currency)}</td><td className="px-3 py-2 text-right num">{fmt(tot.p + tot.i + tot.x, f.currency)}</td></tr></tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">Bankanın verdiği ödeme planı farklıysa satırları düzeltin. Kaydettikten sonra da ödenmemiş taksitler düzenlenebilir.</p>
      {msg && <Notice tone="bad">{msg}</Notice>}
      <div><button type="button" disabled={busy || !rows.length} onClick={save} className={btnPrimary}>{busy ? "Kaydediliyor…" : "Krediyi kaydet"}</button></div>
    </div>
  );
}
