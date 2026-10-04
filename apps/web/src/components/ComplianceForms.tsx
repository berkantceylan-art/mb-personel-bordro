"use client";
import { useActionForm } from "@/lib/use-action-form";
import { useMemo, useState } from "react";
import { addComplianceRecords, addIncident, addPpe, addSickReport } from "@/lib/compliance-actions";

const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white w-full";
type Emp = { id: string; name: string; dept: string };
type R = { ok: boolean; message: string } | null;
const Msg = ({ s }: { s: R }) => (s ? <span role="status" className={`text-sm rounded-lg px-3 py-1.5 ${s.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{s.message}</span> : null);

function EmployeePicker({ employees, preselect }: { employees: Emp[]; preselect?: string[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set(preselect ?? []));
  const [dept, setDept] = useState("");
  const depts = useMemo(() => [...new Set(employees.map((e) => e.dept))], [employees]);
  const list = employees.filter((e) => !dept || e.dept === dept);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="flex flex-col gap-2 md:col-span-full">
      <div className="flex flex-wrap gap-2 items-center text-sm">
        <span className="text-muted">Personel ({sel.size} seçili)</span>
        <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Bölüm" className="h-9 rounded-lg border border-[#D5DEE8] px-2 bg-white">
          <option value="">Tüm bölümler</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <button type="button" onClick={() => setSel((s) => new Set([...s, ...list.map((e) => e.id)]))} className="h-9 px-3 rounded-lg border border-[#D5DEE8] font-semibold text-brand-700">Listelenenleri seç</button>
        <button type="button" onClick={() => setSel(new Set())} className="h-9 px-3 rounded-lg border border-[#D5DEE8] text-muted">Temizle</button>
      </div>
      <div className="flex flex-wrap gap-1.5 max-h-44 overflow-auto p-2 rounded-lg bg-[#F7F9FB]">
        {list.map((e) => (
          <label key={e.id} className={`text-[13px] px-2.5 py-1.5 rounded-full cursor-pointer ${sel.has(e.id) ? "bg-brand-700 text-white" : "bg-white border border-[#D5DEE8]"}`}>
            <input type="checkbox" name="employeeId" value={e.id} checked={sel.has(e.id)} onChange={() => toggle(e.id)} className="sr-only" />{e.name}
          </label>
        ))}
      </div>
    </div>
  );
}

export function RecordForm({ category, types, employees, preselect }: { category: "TRAINING" | "HEALTH"; types: Array<{ id: string; name: string }>; employees: Emp[]; preselect?: string[] }) {
  const { state, pending, formProps: actionProps } = useActionForm(addComplianceRecords);
  const training = category === "TRAINING";
  return (
    <form {...actionProps} className="grid gap-4 md:grid-cols-4 items-end">
      <input type="hidden" name="category" value={category} />
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">{training ? "Eğitim" : "Muayene / tetkik"}
        <select name="typeId" required className={input}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Tarih<input type="date" name="date" required className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Bitiş (boşsa otomatik)<input type="date" name="expires_on" className={input} /></label>
      {training ? (
        <>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Süre (saat)<input name="hours" inputMode="decimal" className={input} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Eğitimci<input name="trainer" className={input} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Kurum / OSGB<input name="provider" className={input} /></label>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Sonuç
            <select name="result" className={input}><option value="UYGUN">Çalışmaya uygun</option><option value="SARTLI">Şartlı uygun</option><option value="UYGUN_DEGIL">Uygun değil</option></select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Hekim<input name="doctor" className={input} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Kurum / OSGB<input name="institution" className={input} /></label>
        </>
      )}
      <label className="flex flex-col gap-1.5 text-sm text-muted">{training ? "Sertifika / katılım listesi" : "Rapor (PDF/foto)"}<input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" className="text-xs" /></label>
      {!training && <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-4">Kısıtlamalar (şartlı uygunsa)<input name="restrictions" className={input} /></label>}
      <EmployeePicker employees={employees} preselect={preselect} />
      <div className="md:col-span-4 flex gap-3 items-center flex-wrap">
        <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">Kaydet</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

export function PpeForm({ employees }: { employees: Emp[] }) {
  const { state, pending, formProps: actionProps } = useActionForm(addPpe);
  return (
    <form {...actionProps} className="grid gap-4 md:grid-cols-5 items-end">
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Malzeme
        <input name="item" required list="ppe-items" placeholder="ör. Toz maskesi FFP2" className={input} />
        <datalist id="ppe-items">{["Toz maskesi FFP2", "Toz maskesi FFP3", "Koruyucu gözlük", "Kulak tıkacı", "Eldiven (nitril)", "İş önlüğü", "Yüz siperi", "İş ayakkabısı"].map((x) => <option key={x} value={x} />)}</datalist>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Beden<input name="size" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Adet<input name="quantity" type="number" min={1} defaultValue={1} className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Veriliş<input type="date" name="issued_on" required className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Yenileme (ay)<input name="renew_months" type="number" min={0} className={input} /></label>
      <EmployeePicker employees={employees} />
      <div className="md:col-span-5 flex gap-3 items-center"><button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">Zimmetle</button><Msg s={state} /></div>
    </form>
  );
}

export function IncidentForm({ employees }: { employees: Emp[] }) {
  const { state, pending, formProps: actionProps } = useActionForm(addIncident);
  return (
    <form {...actionProps} className="grid gap-4 md:grid-cols-4 items-end">
      <label className="flex flex-col gap-1.5 text-sm text-muted">Tür
        <select name="kind" className={input}><option value="RAMAK_KALA">Ramak kala</option><option value="KAZA">İş kazası</option><option value="MESLEK_HASTALIGI">Meslek hastalığı</option></select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Personel
        <select name="employeeId" className={input}><option value="">—</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Tarih / saat<input type="datetime-local" name="occurred_at" required className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Yer<input name="location" placeholder="ör. Freze bölümü" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Açıklama<input name="description" required className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Yaralanma<input name="injury" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">İş günü kaybı<input name="lost_days" type="number" min={0} className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-3">Alınan önlemler<input name="actions_taken" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">SGK bildirim tarihi<input type="date" name="sgk_notified_on" className={input} /></label>
      <div className="md:col-span-4 flex gap-3 items-center"><button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">Kaydet</button><Msg s={state} /></div>
    </form>
  );
}

export function SickReportForm({ employees }: { employees: Emp[] }) {
  const { state, pending, formProps: actionProps } = useActionForm(addSickReport);
  return (
    <form {...actionProps} className="grid gap-4 md:grid-cols-4 items-end">
      <label className="flex flex-col gap-1.5 text-sm text-muted">Personel
        <select name="employeeId" required className={input}><option value="">Seçin</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Başlangıç<input type="date" name="start" required className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Bitiş<input type="date" name="end" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Veren kurum<input name="institution" placeholder="ör. Devlet hastanesi" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Not<input name="diagnosis_note" placeholder="İsteğe bağlı (teşhis yazmak zorunlu değil)" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Rapor belgesi<input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" className="text-xs" /></label>
      <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">Raporu işle</button>
      <div className="md:col-span-4"><Msg s={state} /></div>
    </form>
  );
}
