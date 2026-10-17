"use client";
import { useState } from "react";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import type { PcWorker } from "@/lib/piecework";

const input = "h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3 w-full";
const SUGGEST: Record<string, string> = { none: "0", gider_pusulasi: "20", serbest_meslek: "20", fatura: "0" };

/** Usta kartı: kendi personelimiz (maaşa ek) ya da dışarıdan usta (gider + cari) */
export function WorkerForm({ action, worker, employees, party }: { action: (f: FormData) => Promise<void>; worker?: PcWorker; employees: Array<{ id: string; name: string }>; party?: { iban: string | null; tax_no: string | null } | null }) {
  const [kind, setKind] = useState<"internal" | "external">(worker?.kind ?? "external");
  const [stopaj, setStopaj] = useState(String(worker?.stopaj_pct ?? 0));
  const tab = (k: "internal" | "external", label: string, sub: string) => (
    <button type="button" disabled={!!worker} onClick={() => setKind(k)} className={`flex-1 text-left rounded-[12px] border-2 px-4 py-3 ${kind === k ? "border-brand-700 bg-[#F3F8FD]" : "border-[#E2E8EF] bg-white"} disabled:cursor-default`}>
      <b className="block text-brand-800 text-sm">{label}</b><span className="text-xs text-muted">{sub}</span>
    </button>
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      {worker && <input type="hidden" name="id" value={worker.id} />}
      <input type="hidden" name="kind" value={kind} />
      <div className="flex gap-2">
        {tab("internal", "Kendi personelimiz", "Mesai dışı parça başı → maaşa ek ödeme")}
        {tab("external", "Dışarıdan usta", "Gider + cari borç + ödeme planı")}
      </div>
      {kind === "internal" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm text-muted">Personel *
            <select name="employee_id" required defaultValue={worker?.employee_id ?? ""} disabled={!!worker} className={input}>
              <option value="">Seçin…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            {worker && <input type="hidden" name="employee_id" value={worker.employee_id ?? ""} />}
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Ödeme şekli
            <select name="pay_side" defaultValue={worker?.pay_side ?? "CASH"} className={input}>
              <option value="CASH">Elden (net tutar)</option>
              <option value="OFFICIAL">Resmi — bordroya ek ödeme (brütleştirilir)</option>
            </select>
          </label>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Ad soyad / firma *<input name="name" required defaultValue={worker?.name ?? ""} className={input} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Telefon<input name="phone" defaultValue={worker?.phone ?? ""} className={input} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">IBAN<input name="iban" defaultValue={party?.iban ?? ""} placeholder="TR.." className={`${input} num`} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">TCKN / VKN<input name="tax_no" defaultValue={party?.tax_no ?? ""} inputMode="numeric" className={`${input} num`} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Belge
            <select name="doc_type" defaultValue={worker?.doc_type ?? "none"} onChange={(e) => setStopaj(SUGGEST[e.target.value] ?? "0")} className={input}>
              <option value="none">Belgesiz</option><option value="gider_pusulasi">Gider pusulası</option><option value="serbest_meslek">Serbest meslek makbuzu</option><option value="fatura">Fatura</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Stopaj %<input name="stopaj_pct" value={stopaj} onChange={(e) => setStopaj(e.target.value)} inputMode="decimal" className={`${input} num`} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Ödeme vadesi (gün)<input name="pay_days" type="number" min={0} max={120} defaultValue={worker?.pay_days ?? 7} className={`${input} num`} /></label>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Not<input name="note" defaultValue={worker?.note ?? ""} maxLength={500} className={input} /></label>
        {worker && (
          <label className="flex flex-col gap-1.5 text-sm text-muted">Durum
            <select name="is_active" defaultValue={worker.is_active ? "on" : "off"} className={input}><option value="on">Aktif</option><option value="off">Pasif</option></select>
          </label>
        )}
      </div>
      {kind === "external" && <p className="text-xs text-muted">Stopaj oranını muhasebecinizle teyit edin (öneri: gider pusulası / serbest meslek %20). Usta için finans carisi otomatik açılır; aynı TCKN/VKN’li cari varsa o kullanılır.</p>}
      <PendingSubmit className="h-11 rounded-[10px] bg-brand-700 text-white font-semibold self-start px-6">{worker ? "Kaydet" : "Usta ekle"}</PendingSubmit>
    </form>
  );
}
