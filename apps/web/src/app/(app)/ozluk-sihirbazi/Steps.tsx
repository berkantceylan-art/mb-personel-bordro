"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { dossCreate, dossSaveExit, dossSaveHire, dossSaveIdentity, dossSaveLeaves, dossSavePayslips, dossSetType, type DossResult } from "@/lib/dossier-actions";
import { Capture } from "./Capture";

const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white w-full text-ink";
const Lbl = ({ t, children, wide, ai }: { t: string; children: React.ReactNode; wide?: boolean; ai?: boolean }) => (
  <label className={`flex flex-col gap-1 text-xs text-muted ${wide ? "md:col-span-2" : ""}`}>
    <span>{t}{ai && <span className="ml-1 text-[10px] font-bold text-brand-700 bg-[#E7F1FB] px-1.5 py-0.5 rounded">okundu</span>}</span>
    {children}
  </label>
);
const Msg = ({ s }: { s: { ok: boolean; message: string } | null }) =>
  s ? <span role="status" className={`text-sm rounded-lg px-3 py-1.5 ${s.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{s.message}</span> : null;

type Rec = Record<string, string>;
function useFields(initial: Rec) {
  const [v, setV] = useState<Rec>(initial);
  const [ai, setAi] = useState<Set<string>>(new Set());
  const merge = (d: Record<string, unknown> | undefined, map: Record<string, string> = {}) => {
    if (!d) return;
    const next: Rec = {};
    for (const [k, val] of Object.entries(d)) if (val !== undefined && val !== null && String(val).trim()) next[map[k] ?? k] = String(val);
    setV((c) => ({ ...c, ...next }));
    setAi((c) => new Set([...c, ...Object.keys(next)]));
  };
  const bind = (k: string) => ({ name: k, value: v[k] ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((c) => ({ ...c, [k]: e.target.value })) });
  return { v, ai, merge, bind };
}

/* ------------------------------------------------------------------ 1. Kimlik */
export function IdentityStep({ employeeId, companyId, initial, nextHref }: { employeeId: string; companyId: string; initial: Rec; nextHref: string }) {
  const router = useRouter();
  const f = useFields(initial);
  const { state, pending, formProps } = useActionForm(dossSaveIdentity, { onSuccess: () => router.push(nextHref) });
  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr] items-start">
      <Capture employeeId={employeeId} companyId={companyId} mode="id" title="Kimliği okut" hint="Nüfus cüzdanının önünü ve arkasını çekin (ya da nüfus kayıt örneği). Bilgiler forma otomatik dolar." onDone={(r) => f.merge(r.id as Record<string, unknown>)} />
      <form {...formProps} className="grid gap-3 md:grid-cols-2">
        <input type="hidden" name="employeeId" value={employeeId} />
        <Lbl t="Ad *" ai={f.ai.has("first_name")}><input {...f.bind("first_name")} required className={input} /></Lbl>
        <Lbl t="Soyad *" ai={f.ai.has("last_name")}><input {...f.bind("last_name")} required className={input} /></Lbl>
        <Lbl t="TC kimlik no" ai={f.ai.has("national_id")}><input {...f.bind("national_id")} inputMode="numeric" maxLength={11} className={`${input} num`} /></Lbl>
        <Lbl t="Doğum tarihi" ai={f.ai.has("birth_date")}><input type="date" {...f.bind("birth_date")} className={input} /></Lbl>
        <Lbl t="Doğum yeri" ai={f.ai.has("birth_place")}><input {...f.bind("birth_place")} className={input} /></Lbl>
        <Lbl t="Cinsiyet" ai={f.ai.has("gender")}><select {...f.bind("gender")} className={input}><option value="">—</option><option value="E">Erkek</option><option value="K">Kadın</option></select></Lbl>
        <Lbl t="Baba adı" ai={f.ai.has("father_name")}><input {...f.bind("father_name")} className={input} /></Lbl>
        <Lbl t="Anne adı" ai={f.ai.has("mother_name")}><input {...f.bind("mother_name")} className={input} /></Lbl>
        <Lbl t="Medeni durum" ai={f.ai.has("marital_status")}><select {...f.bind("marital_status")} className={input}><option value="">—</option><option value="bekar">Bekâr</option><option value="evli">Evli</option><option value="boşanmış">Boşanmış</option><option value="dul">Dul</option></select></Lbl>
        <Lbl t="Çocuk sayısı"><input {...f.bind("children_count")} inputMode="numeric" className={input} /></Lbl>
        <Lbl t="Kan grubu" ai={f.ai.has("blood_type")}><input {...f.bind("blood_type")} placeholder="A Rh+" className={input} /></Lbl>
        <Lbl t="Öğrenim"><select {...f.bind("education")} className={input}><option value="">—</option>{["İlkokul", "Ortaokul", "Lise", "Meslek lisesi", "Ön lisans", "Lisans", "Yüksek lisans"].map((x) => <option key={x}>{x}</option>)}</select></Lbl>
        <Lbl t="Telefon"><input {...f.bind("phone")} inputMode="tel" className={input} /></Lbl>
        <Lbl t="E-posta"><input {...f.bind("email")} type="email" className={input} /></Lbl>
        <Lbl t="Adres" wide><textarea {...f.bind("address")} rows={2} className={`${input} h-auto py-2`} /></Lbl>
        <Lbl t="Acil durumda aranacak kişi"><input {...f.bind("emergency_contact_name")} className={input} /></Lbl>
        <Lbl t="Acil durum telefonu"><input {...f.bind("emergency_contact_phone")} inputMode="tel" className={input} /></Lbl>
        <Lbl t="IBAN"><input {...f.bind("iban")} placeholder="TR.." className={`${input} num`} /></Lbl>
        <Lbl t="Askerlik"><select {...f.bind("military_status")} className={input}><option value="">—</option>{["Yapıldı", "Muaf", "Tecilli", "Yükümlü değil"].map((x) => <option key={x}>{x}</option>)}</select></Lbl>
        <Lbl t="Ehliyet"><input {...f.bind("driving_license")} placeholder="B" className={input} /></Lbl>
        <div className="md:col-span-2 flex flex-wrap gap-3 items-center pt-1">
          <button disabled={pending} className="h-12 px-6 rounded-xl bg-brand-700 text-white font-bold disabled:opacity-60">{pending ? "Kaydediliyor…" : "Kaydet ve devam →"}</button>
          <Msg s={state} />
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ 2. İşe giriş */
export function HireStep({ employeeId, companyId, initial, departments, hasContract, nextHref }: { employeeId: string; companyId: string; initial: Rec; departments: Array<{ id: string; name: string }>; hasContract: boolean; nextHref: string }) {
  const router = useRouter();
  const f = useFields(initial);
  const [exitNote, setExitNote] = useState("");
  const { state, pending, formProps } = useActionForm(dossSaveHire, { onSuccess: () => router.push(nextHref) });
  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr] items-start">
      <Capture employeeId={employeeId} companyId={companyId} mode="sgk" title="SGK işe giriş bildirgesini okut" hint="e-Devlet çıktısı ya da bildirge; giriş tarihi, sigorta no, meslek kodu dolar."
        onDone={(r) => { f.merge(r.sgk as Record<string, unknown>, { occupation_code: "sgk_occupation_code" }); if (r.sgk?.kind === "cikis") setExitNote(`Çıkış bildirgesi okundu: ${r.sgk.termination_date ?? ""}${r.sgk.exit_code ? ` · kod ${r.sgk.exit_code}` : ""}. 6. adımda kaydedin.`); }} />
      <form {...formProps} className="grid gap-3 md:grid-cols-2">
        <input type="hidden" name="employeeId" value={employeeId} />
        {exitNote && <p className="md:col-span-2 text-sm rounded-lg px-3 py-2 bg-warn-bg text-warn">{exitNote}</p>}
        <Lbl t="İşe giriş tarihi *" ai={f.ai.has("hire_date")}><input type="date" {...f.bind("hire_date")} required className={input} /></Lbl>
        <Lbl t="SGK sicil / sigorta no" ai={f.ai.has("sgk_no")}><input {...f.bind("sgk_no")} className={`${input} num`} /></Lbl>
        <Lbl t="PDKS kart / sicil no"><input {...f.bind("card_no")} className={`${input} num`} /></Lbl>
        <Lbl t="SGK meslek kodu" ai={f.ai.has("sgk_occupation_code")}><input {...f.bind("sgk_occupation_code")} placeholder="7311.03" className={`${input} num`} /></Lbl>
        <Lbl t="Bölüm"><select {...f.bind("department_id")} className={input}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Lbl>
        <Lbl t="Görev / unvan" ai={f.ai.has("occupation_name")}><input {...f.bind("position_title")} placeholder={f.v.occupation_name ?? ""} className={input} /></Lbl>
        <Lbl t="Sözleşme türü"><select {...f.bind("contract_type")} className={input}><option value="belirsiz">Belirsiz süreli</option><option value="belirli">Belirli süreli</option><option value="kismi">Kısmi süreli</option><option value="cagri">Çağrı üzerine</option></select></Lbl>
        <label className="flex items-center gap-2 text-sm text-muted self-end h-11"><input type="checkbox" name="is_retired" defaultChecked={initial.is_retired === "true"} className="w-5 h-5" />Emekli (SGDP)</label>
        {!hasContract ? (
          <fieldset className="md:col-span-2 grid gap-3 md:grid-cols-4 rounded-[12px] border border-line p-3">
            <legend className="text-xs font-semibold text-brand-800 px-1">Ücret (ilk kayıt)</legend>
            <Lbl t="Anlaşılan aylık toplam net"><input name="total_net" inputMode="decimal" placeholder="45.000" className={`${input} num`} /></Lbl>
            <Lbl t="Sigorta"><select name="insurance_type" defaultValue="MIN_WAGE" className={input}><option value="MIN_WAGE">Asgari ücret üzerinden</option><option value="FIXED_NET">Belirli resmi net</option></select></Lbl>
            <Lbl t="Resmi net (belirliyse)"><input name="fixed_official_net" inputMode="decimal" className={`${input} num`} /></Lbl>
            <Lbl t="Geçerlilik başlangıcı"><input type="date" name="contract_from" defaultValue={f.v.hire_date ?? ""} className={input} /></Lbl>
          </fieldset>
        ) : <p className="md:col-span-2 text-xs text-muted">Ücret kaydı var; değişiklikler personel kartındaki Zam ekranından yapılır.</p>}
        <div className="md:col-span-2 flex flex-wrap gap-3 items-center pt-1">
          <button disabled={pending} className="h-12 px-6 rounded-xl bg-brand-700 text-white font-bold disabled:opacity-60">{pending ? "Kaydediliyor…" : "Kaydet ve devam →"}</button>
          <Msg s={state} />
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ 3. Belge türü düzeltme */
export function TypeSelect({ id, employeeId, typeId, types }: { id: string; employeeId: string; typeId: string; types: Array<{ id: string; name: string }> }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={dossSetType}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="employeeId" value={employeeId} />
      <select name="typeId" defaultValue={typeId} onChange={() => ref.current?.requestSubmit()} aria-label="Belge türü" className="h-9 rounded-lg border border-[#D5DEE8] bg-white px-2 text-xs max-w-[220px]">
        {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </form>
  );
}

/* ------------------------------------------------------------------ 4. Eski bordrolar */
type SlipRow = { period: string; days: string; gross: string; sgk_employee: string; unemployment_employee: string; income_tax: string; stamp_tax: string; net: string; bes: string; garnishment: string; net_paid: string; cumulative_tax_base: string; documentId: string };
const SLIP_COLS: Array<[keyof SlipRow, string, string]> = [["period", "Dönem", "w-24"], ["days", "Gün", "w-14"], ["gross", "Brüt", "w-28"], ["sgk_employee", "SGK işçi", "w-24"], ["unemployment_employee", "İşsizlik", "w-20"], ["income_tax", "Gelir v.", "w-24"], ["stamp_tax", "Damga v.", "w-20"], ["net", "Net", "w-28"], ["bes", "BES", "w-20"], ["garnishment", "İcra", "w-20"], ["net_paid", "Ödenen", "w-28"], ["cumulative_tax_base", "Küm. matrah", "w-28"]];
const emptySlip = (): SlipRow => ({ period: "", days: "30", gross: "", sgk_employee: "", unemployment_employee: "", income_tax: "", stamp_tax: "", net: "", bes: "", garnishment: "", net_paid: "", cumulative_tax_base: "", documentId: "" });

export function SlipsStep({ employeeId, companyId, canSave, initialRows = [] }: { employeeId: string; companyId: string; canSave: boolean; initialRows?: Array<Record<string, unknown>> }) {
  const [rows, setRows] = useState<SlipRow[]>(() => initialRows.map((s) => ({ ...emptySlip(), ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])) }) as SlipRow));
  const { state, pending, formProps } = useActionForm(dossSavePayslips, { onSuccess: () => setRows([]) });
  const onDone = (r: DossResult) => setRows((cur) => [...cur, ...(r.slips ?? []).map((s) => ({ ...emptySlip(), ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])), documentId: s.documentId ?? "" }))].sort((a, b) => a.period.localeCompare(b.period)));
  const set = (i: number, k: keyof SlipRow, v: string) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="flex flex-col gap-4">
      <Capture employeeId={employeeId} companyId={companyId} mode="payslip" title="Eski bordroları okut" hint="Her ayın bordrosunu art arda çekin ya da tarayıcıdan çok sayfalı PDF yükleyin; her ay ayrı satır olur. Tutarlar TL." onDone={onDone} />
      {rows.length > 0 && (
        <form {...formProps} className="flex flex-col gap-3">
          <input type="hidden" name="employeeId" value={employeeId} />
          <input type="hidden" name="rows" value={JSON.stringify(rows)} />
          <p className="text-sm text-brand-800 font-semibold">Okunan {rows.length} ay — kontrol edin, gerekirse düzeltin:</p>
          <div className="overflow-x-auto">
            <table className="text-[12px]">
              <thead><tr className="text-muted">{SLIP_COLS.map(([, l]) => <th key={l} className="px-1 py-1 text-left font-semibold">{l}</th>)}<th /></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={/^\d{4}-\d{2}$/.test(r.period) ? "" : "bg-bad-bg"}>
                    {SLIP_COLS.map(([k, , w]) => <td key={k} className="px-0.5 py-0.5"><input value={r[k]} onChange={(e) => set(i, k, e.target.value)} placeholder={k === "period" ? "2026-03" : ""} className={`num h-9 rounded-md border border-[#D5DEE8] px-1.5 text-right ${w}`} /></td>)}
                    <td><button type="button" onClick={() => setRows((c) => c.filter((_, j) => j !== i))} className="h-9 px-2 text-muted" aria-label="Satırı sil">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <button type="button" onClick={() => setRows((c) => [...c, emptySlip()])} className="h-10 px-3 rounded-lg border border-[#D5DEE8] bg-white text-sm font-semibold text-brand-700">+ Elle satır</button>
            <button disabled={pending || !canSave} className="h-11 px-5 rounded-xl bg-brand-700 text-white font-bold disabled:opacity-50">{pending ? "Kaydediliyor…" : `${rows.length} ayı kaydet`}</button>
            {!canSave && <span className="text-xs text-warn">Bordro kaydı için sahip / muhasebe yetkisi gerekir.</span>}
            <Msg s={state} />
          </div>
        </form>
      )}
      {rows.length === 0 && <button type="button" onClick={() => setRows([emptySlip()])} className="self-start text-sm font-semibold text-brand-700">+ Okutmadan elle bordro gir</button>}
    </div>
  );
}

/* ------------------------------------------------------------------ 5. İzinler */
export type LeaveRow = { type: string; start: string; end: string; days: string; documentId: string };
export function LeavesStep({ employeeId, companyId, types, initialRows = [] }: { employeeId: string; companyId: string; types: Array<{ code: string; name: string }>; initialRows?: LeaveRow[] }) {
  const [rows, setRows] = useState<LeaveRow[]>(initialRows);
  const { state, pending, formProps } = useActionForm(dossSaveLeaves, { onSuccess: () => setRows([]) });
  const blank = (): LeaveRow => ({ type: "YILLIK", start: "", end: "", days: "", documentId: "" });
  const onDone = (r: DossResult) => setRows((cur) => [...cur, ...(r.leaves ?? []).map((l) => ({ type: l.type ?? "YILLIK", start: l.start ?? "", end: l.end ?? "", days: l.days ? String(l.days) : "", documentId: l.documentId ?? "" }))]);
  const set = (i: number, k: keyof LeaveRow, v: string) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="flex flex-col gap-4">
      <Capture employeeId={employeeId} companyId={companyId} mode="leave" title="İzin formlarını / raporları okut" hint="Yıllık izin formları, izin defteri sayfaları, sağlık raporları." onDone={onDone} />
      {rows.length > 0 && (
        <form {...formProps} className="flex flex-col gap-3">
          <input type="hidden" name="employeeId" value={employeeId} />
          <input type="hidden" name="rows" value={JSON.stringify(rows)} />
          <div className="flex flex-col gap-1.5">
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap gap-2 items-center">
                <select value={r.type} onChange={(e) => set(i, "type", e.target.value)} className="h-10 rounded-lg border border-[#D5DEE8] bg-white px-2 text-sm">{types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
                <input type="date" value={r.start} onChange={(e) => set(i, "start", e.target.value)} className="h-10 rounded-lg border border-[#D5DEE8] px-2 text-sm" aria-label="Başlangıç" />
                <input type="date" value={r.end} onChange={(e) => set(i, "end", e.target.value)} className="h-10 rounded-lg border border-[#D5DEE8] px-2 text-sm" aria-label="Bitiş" />
                <input value={r.days} onChange={(e) => set(i, "days", e.target.value)} placeholder="gün" inputMode="decimal" className="h-10 w-16 rounded-lg border border-[#D5DEE8] px-2 text-sm num" aria-label="Gün" />
                <button type="button" onClick={() => setRows((c) => c.filter((_, j) => j !== i))} className="h-10 px-2 text-muted" aria-label="Sil">✕</button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <button type="button" onClick={() => setRows((c) => [...c, blank()])} className="h-10 px-3 rounded-lg border border-[#D5DEE8] bg-white text-sm font-semibold text-brand-700">+ Elle izin</button>
            <button disabled={pending} className="h-11 px-5 rounded-xl bg-brand-700 text-white font-bold disabled:opacity-50">{pending ? "Kaydediliyor…" : `${rows.length} izni kaydet`}</button>
            <Msg s={state} />
          </div>
        </form>
      )}
      {rows.length === 0 && <button type="button" onClick={() => setRows([blank()])} className="self-start text-sm font-semibold text-brand-700">+ Okutmadan elle izin gir</button>}
    </div>
  );
}

/* ------------------------------------------------------------------ 6. Çıkış */
export function ExitForm({ employeeId, initial, codes }: { employeeId: string; initial: Rec; codes: Array<[string, string]> }) {
  const { state, pending, formProps } = useActionForm(dossSaveExit);
  return (
    <form {...formProps} className="grid gap-3 md:grid-cols-3 items-end">
      <input type="hidden" name="employeeId" value={employeeId} />
      <Lbl t="İşten çıkış tarihi (çalışıyorsa boş)"><input type="date" name="termination_date" defaultValue={initial.termination_date ?? ""} className={input} /></Lbl>
      <Lbl t="SGK çıkış kodu"><select name="termination_code" defaultValue={initial.termination_code ?? ""} className={input}><option value="">—</option>{codes.map(([c, l]) => <option key={c} value={c}>{c} · {l.slice(0, 60)}</option>)}</select></Lbl>
      <Lbl t="Açıklama"><input name="termination_reason" defaultValue={initial.termination_reason ?? ""} className={input} /></Lbl>
      <div className="md:col-span-3 flex gap-3 items-center">
        <button disabled={pending} className="h-11 px-5 rounded-xl border border-brand-700 text-brand-700 font-semibold disabled:opacity-50">Çıkış bilgisini kaydet</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ Telefon bağlantısı */
export function PhonePanel({ qr, url }: { qr: string; url: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [open, router]);
  return (
    <details className="rounded-[14px] border border-line bg-white p-3" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer font-semibold text-brand-700 text-sm">📱 Telefonu kamera olarak bağla</summary>
      <div className="mt-3 flex flex-wrap gap-4 items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="Telefon bağlantı kodu" className="w-40 h-40 rounded-lg border border-line" />
        <div className="text-sm flex flex-col gap-1 max-w-sm">
          <p>Telefonun kamerasıyla bu kodu okutun (ERP&apos;ye aynı hesapla giriş yapılmış olmalı). Telefonda çektiğiniz belgeler birkaç saniye içinde bu ekrana düşer.</p>
          <p className="text-xs text-muted break-all">{url}</p>
          {open && <p className="text-xs text-ok">Canlı: ekran 5 saniyede bir yenileniyor.</p>}
        </div>
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ Klasörden yeni personel */
export function CreateForm() {
  const { state, pending, formProps } = useActionForm(dossCreate);
  return (
    <form {...formProps} className="flex flex-wrap gap-3 items-end">
      <label className="flex flex-col gap-1 text-xs text-muted">Ad<input name="first_name" required className={input} /></label>
      <label className="flex flex-col gap-1 text-xs text-muted">Soyad<input name="last_name" required className={input} /></label>
      <label className="flex flex-col gap-1 text-xs text-muted">İşe giriş<input type="date" name="hire_date" className={input} /></label>
      <label className="flex items-center gap-2 text-sm text-muted h-11"><input type="checkbox" name="left" className="w-5 h-5" />Ayrılmış personel</label>
      <button disabled={pending} className="h-11 px-5 rounded-xl bg-brand-700 text-white font-semibold disabled:opacity-50">Klasörü başlat →</button>
      <Msg s={state} />
    </form>
  );
}
