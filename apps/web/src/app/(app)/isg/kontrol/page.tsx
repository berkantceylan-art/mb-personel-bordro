import { redirect } from "next/navigation";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { IsgNav } from "@/components/IsgNav";
import { Card, PageHeader, Stat } from "@/components/ui";
import { deleteRow, saveEquipment, saveMeasurement, saveSds } from "@/lib/isg-actions";
import { signedMap } from "@/lib/isg-data";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2.5 text-sm w-full";
const btn = "h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm";
/** Diş laboratuvarında sık görülen periyodik kontroller (İş Ekipmanları Yönetmeliği Ek-III) */
const PRESETS: Array<[string, string, number]> = [["Kompresör / hava tankı", "Basınçlı kap", 12], ["Elektrik iç tesisatı", "Elektrik", 12], ["Topraklama ve paratoner", "Elektrik", 12], ["Yangın söndürme tüpleri", "Yangın", 6], ["Yangın algılama / alarm", "Yangın", 12], ["Lokal egzoz / toz toplama", "Havalandırma", 12], ["Kumlama kabini", "Makine", 12], ["Döküm makinesi / fırın", "Makine", 12], ["Asansör / yük asansörü", "Kaldırma", 3], ["Doğalgaz / LPG tesisatı", "Gaz", 12]];
const MEAS = ["Solunabilir toz", "Kristal silika", "Gürültü", "Aydınlatma", "Termal konfor", "Metil metakrilat buharı", "Metal dumanı", "Havalandırma hava hızı"];

/** Periyodik kontroller, ortam ölçümleri ve güvenlik bilgi formları */
export default async function ChecksPage() {
  const s = await getSession();
  if (!["owner", "hr", "safety", "accountant", "branch_manager"].includes(s.role)) redirect("/");
  const can = ["owner", "hr", "safety"].includes(s.role);
  const supabase = await createClient();
  const today = todayIso();
  const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: eq, error }, { data: ms }, { data: sds }] = await Promise.all([
    supabase.from("equipment_checks").select("*").order("next_due", { nullsFirst: true }),
    supabase.from("env_measurements").select("*").order("measured_on", { ascending: false }),
    supabase.from("sds_documents").select("*").order("product"),
  ]);
  if (error) return (<><PageHeader title="Kontrol ve ölçüm" /><div className="p-6"><Card><p className="text-sm">Bu bölüm için Supabase&apos;de <b>20261119000000_isg.sql</b> çalıştırılmalı.</p></Card></div></>);
  const files = await signedMap(supabase, [...(eq ?? []).map((x) => x.report_path), ...(ms ?? []).map((x) => x.report_path), ...(sds ?? []).map((x) => x.document_path)]);
  const latestKind = new Map<string, (typeof ms extends Array<infer T> | null ? T : never)>();
  for (const m of ms ?? []) if (!latestKind.has(m.kind)) latestKind.set(m.kind, m);
  const F = (p: string | null) => (p && files.get(p) ? <a href={files.get(p)} target="_blank" rel="noreferrer" className="text-brand-700 font-semibold text-xs">rapor</a> : null);
  return (
    <>
      <PageHeader title="Kontrol, ölçüm ve kimyasallar" subtitle="Periyodik kontroller, ortam ölçümleri, güvenlik bilgi formları" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1100px]">
        <IsgNav active="/isg/kontrol" />
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Stat label="Süresi geçen kontrol" value={String((eq ?? []).filter((x) => !x.next_due || x.next_due < today).length)} />
          <Stat label="30 gün içinde" value={String((eq ?? []).filter((x) => x.next_due && x.next_due >= today && x.next_due <= soon).length)} />
          <Stat label="Limit aşan ölçüm" value={String([...latestKind.values()].filter((m) => m.compliant === false).length)} />
          <Stat label="Güvenlik bilgi formu" value={String((sds ?? []).length)} />
        </div>
        <Card title="Periyodik kontroller">
          <ul className="text-sm divide-y divide-[#EEF2F6]">{(eq ?? []).map((x) => { const late = !x.next_due || x.next_due < today; return (
            <li key={x.id} className="py-2 flex flex-wrap items-center gap-2"><span className="flex-1 min-w-[200px]"><b>{x.equipment}</b> <span className="text-muted">· {x.category}{x.location ? ` · ${x.location}` : ""}{x.serial_no ? ` · ${x.serial_no}` : ""}</span></span>
              <span className="text-xs">{x.last_check ? `son ${formatDate(x.last_check)}` : "kontrol yok"}{x.result ? ` · ${x.result === "uygun" ? "uygun" : x.result === "sartli" ? "şartlı" : "UYGUN DEĞİL"}` : ""}</span>
              <span className={`text-xs font-semibold ${late ? "text-bad" : x.next_due! <= soon ? "text-warn" : "text-ok"}`}>{x.next_due ? `sonraki ${formatDate(x.next_due)}` : "tarih yok"}</span>{F(x.report_path)}
              {can && <details className="w-full"><summary className="cursor-pointer text-xs text-brand-700 font-semibold">Kontrol yapıldı</summary><form action={saveEquipment} className="grid gap-2 sm:grid-cols-4 mt-2"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="equipment" value={x.equipment} /><input type="hidden" name="category" value={x.category} /><input type="hidden" name="period_months" value={x.period_months} /><input type="date" name="last_check" required defaultValue={today} className={input} aria-label="Kontrol tarihi" /><input name="inspector" defaultValue={x.inspector ?? ""} placeholder="Kontrol eden (yetkili kişi/kurum)" className={input} aria-label="Kontrol eden" /><select name="result" className={input} aria-label="Sonuç"><option value="uygun">Uygun</option><option value="sartli">Şartlı uygun</option><option value="uygun-degil">Uygun değil</option></select><input type="file" name="file" accept="application/pdf,image/*" className="text-sm" aria-label="Rapor" /><PendingSubmit className={`${btn} justify-self-start`}>Kaydet</PendingSubmit></form></details>}
            </li>
          ); })}{(eq ?? []).length === 0 && <li className="py-2 text-muted">Ekipman yok.</li>}</ul>
          {can && (
            <details className="rounded-xl border border-dashed border-[#B9C7D6] p-3"><summary className="cursor-pointer font-semibold text-brand-700">Ekipman ekle</summary>
              <form action={saveEquipment} className="grid gap-2 sm:grid-cols-3 mt-3 text-sm">
                <input name="equipment" required list="presets" placeholder="Ekipman" className={input} aria-label="Ekipman" />
                <datalist id="presets">{PRESETS.map(([n]) => <option key={n} value={n} />)}</datalist>
                <input name="category" required list="cats" placeholder="Kategori" className={input} aria-label="Kategori" />
                <datalist id="cats">{[...new Set(PRESETS.map((p) => p[1]))].map((c) => <option key={c} value={c} />)}</datalist>
                <input name="period_months" required inputMode="numeric" placeholder="Periyot (ay)" className={input} aria-label="Periyot" />
                <input name="location" placeholder="Yer" className={input} aria-label="Yer" />
                <input name="serial_no" placeholder="Seri no" className={input} aria-label="Seri no" />
                <label className="text-xs text-muted flex flex-col gap-1">Son kontrol<input type="date" name="last_check" className={input} /></label>
                <PendingSubmit className={`${btn} justify-self-start`}>Ekle</PendingSubmit>
              </form>
              <p className="text-xs text-muted mt-2">Örnek periyotlar: {PRESETS.map(([n, , m]) => `${n} ${m} ay`).join(" · ")}. Kontroller yetkili kişi veya akredite kuruluşça yapılmalıdır.</p>
            </details>
          )}
        </Card>
        <Card title="Ortam ölçümleri">
          <ul className="text-sm divide-y divide-[#EEF2F6]">{(ms ?? []).map((m) => (
            <li key={m.id} className="py-1.5 flex flex-wrap items-center gap-2"><b className="flex-1 min-w-40">{m.kind}</b><span className="text-xs text-muted">{m.location}</span><span className="num text-xs">{m.value ?? "—"} {m.unit ?? ""}{m.limit_value !== null ? ` / limit ${m.limit_value}` : ""}</span><span className={`text-xs font-semibold ${m.compliant === false ? "text-bad" : m.compliant ? "text-ok" : "text-muted"}`}>{m.compliant === false ? "Limit üstü" : m.compliant ? "Uygun" : "—"}</span><span className="num text-xs">{formatDate(m.measured_on)}{m.next_due ? ` → ${formatDate(m.next_due)}` : ""}</span>{F(m.report_path)}{can && <form action={deleteRow}><input type="hidden" name="table" value="env_measurements" /><input type="hidden" name="id" value={m.id} /><ConfirmSubmit label="×" /></form>}</li>
          ))}{(ms ?? []).length === 0 && <li className="py-2 text-muted">Ölçüm kaydı yok. Diş laboratuvarlarında solunabilir toz ve kristal silika ölçümü öncelikli.</li>}</ul>
          {can && <form action={saveMeasurement} className="grid gap-2 sm:grid-cols-4 text-sm">
            <input name="kind" required list="meas" placeholder="Ölçüm" className={input} aria-label="Ölçüm" /><datalist id="meas">{MEAS.map((m) => <option key={m} value={m} />)}</datalist>
            <input type="date" name="measured_on" required defaultValue={today} className={input} aria-label="Tarih" />
            <input name="location" placeholder="Yer" className={input} aria-label="Yer" />
            <input name="lab" placeholder="Akredite laboratuvar" className={input} aria-label="Laboratuvar" />
            <input name="value" inputMode="decimal" placeholder="Sonuç" className={input} aria-label="Sonuç" />
            <input name="unit" placeholder="Birim (mg/m³, dB(A), lüks)" className={input} aria-label="Birim" />
            <input name="limit_value" inputMode="decimal" placeholder="Sınır değer" className={input} aria-label="Sınır" />
            <input type="file" name="file" accept="application/pdf,image/*" className="text-sm" aria-label="Rapor" />
            <PendingSubmit className={`${btn} justify-self-start`}>Ekle</PendingSubmit>
          </form>}
        </Card>
        <Card title="Güvenlik bilgi formları (GBF / MSDS)">
          <ul className="text-sm divide-y divide-[#EEF2F6]">{(sds ?? []).map((x) => <li key={x.id} className="py-1.5 flex flex-wrap items-center gap-2"><b className="flex-1 min-w-40">{x.product}</b><span className="text-xs text-muted">{[x.supplier, x.used_in, x.hazards].filter(Boolean).join(" · ")}</span><span className="text-xs">{x.revised_on ? `rev. ${formatDate(x.revised_on)}` : ""}</span>{F(x.document_path)}{can && <form action={deleteRow}><input type="hidden" name="table" value="sds_documents" /><input type="hidden" name="id" value={x.id} /><ConfirmSubmit label="×" /></form>}</li>)}{(sds ?? []).length === 0 && <li className="py-2 text-muted">GBF yok. Akrilik monomer, asitler, döküm alaşımları, alçı, kumlama tozu için ekleyin.</li>}</ul>
          {can && <form action={saveSds} className="grid gap-2 sm:grid-cols-3 text-sm">
            <input name="product" required placeholder="Ürün" className={input} aria-label="Ürün" />
            <input name="supplier" placeholder="Tedarikçi" className={input} aria-label="Tedarikçi" />
            <input name="used_in" placeholder="Kullanıldığı bölüm" className={input} aria-label="Bölüm" />
            <input name="hazards" placeholder="Tehlike ifadeleri (H225, H317…)" className={input} aria-label="Tehlikeler" />
            <label className="text-xs text-muted flex flex-col gap-1">Revizyon tarihi<input type="date" name="revised_on" className={input} /></label>
            <input type="file" name="file" accept="application/pdf" className="text-sm" aria-label="GBF dosyası" />
            <PendingSubmit className={`${btn} justify-self-start`}>Ekle</PendingSubmit>
          </form>}
        </Card>
      </div>
    </>
  );
}
