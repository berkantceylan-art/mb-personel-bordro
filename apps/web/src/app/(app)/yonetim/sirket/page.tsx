import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Tabs } from "@/components/Compliance";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { BranchForm } from "../AdminForms";
import { deleteDepartment, deleteDevice, saveCompanyInfo, saveDepartment, saveDevice } from "../actions";

export const dynamic = "force-dynamic";

/** Şirket ayarları: şirket bilgileri, şubeler ve konum, bölümler, PDKS cihazları */
export default async function CompanySettings({ searchParams }: { searchParams: Promise<{ sekme?: string }> }) {
  const s = await getSession();
  if (s.role !== "owner" && (s.modules.users ?? 0) < 2) redirect("/");
  const sp = await searchParams;
  const tab = ["bilgiler", "subeler", "bolumler", "cihazlar"].includes(sp.sekme ?? "") ? sp.sekme! : "bilgiler";
  const isOwner = s.role === "owner";
  const supabase = await createClient();
  const [{ data: branches }, { data: departments }, { data: emps }, devices, company] = await Promise.all([
    supabase.from("branches").select("id, name, address, lat, lng, radius_m, mobile_punch_enabled").order("name"),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("employees").select("id, department_id").eq("status", "active"),
    tab === "cihazlar" ? supabase.from("devices").select("*").order("code") : Promise.resolve({ data: [] }),
    tab === "bilgiler" ? supabase.from("companies").select("*").eq("id", s.companyId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const deptCount = new Map<string, number>();
  for (const e of emps ?? []) if (e.department_id) deptCount.set(e.department_id, (deptCount.get(e.department_id) ?? 0) + 1);

  return (
    <>
      <PageHeader title="Şirket ayarları" subtitle="Sözleşme ve formlara yazılan bilgiler, şubeler, bölümler ve PDKS cihazları" actions={<Link href="/yonetim" className="text-sm font-semibold text-brand-700">Kullanıcılar ve hesaplar</Link>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1320px]">
        <Tabs base="/yonetim/sirket" active={tab} tabs={[["bilgiler", "Şirket bilgileri"], ["subeler", "Şubeler ve konum"], ["bolumler", "Bölümler"], ["cihazlar", "PDKS cihazları"]]} />
        {tab === "bilgiler" && (() => {
          const c = (company.data ?? {}) as Record<string, string | null>;
          const inp = "h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3.5 w-full";
          const fields: Array<[string, string, string?]> = [
            ["name", "Şirket unvanı"], ["sgk_registration_no", "SGK işyeri sicil no", "Muayene formu ve bankaya verilen dosyalarda kullanılır"], ["tax_office", "Vergi dairesi"], ["tax_no", "Vergi numarası"],
            ["phone", "Telefon"], ["email", "KVKK başvuru e-postası", "Aydınlatma metninde personelin başvuracağı adres"],
          ];
          return (
            <Card title="Şirket bilgileri" action={<span className="text-xs text-muted">İş sözleşmesi, gizlilik sözleşmesi, KVKK ve muayene formuna yazılır</span>}>
              <form action={saveCompanyInfo} className="grid gap-4 md:grid-cols-2">
                {fields.map(([k, label, hint]) => (
                  <label key={k} className="flex flex-col gap-1.5 text-sm text-muted">
                    {label}
                    <input name={k} defaultValue={c[k] ?? ""} disabled={!isOwner} className={inp} />
                    {hint && <span className="text-xs">{hint}</span>}
                  </label>
                ))}
                <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">
                  Adres
                  <textarea name="address" rows={2} defaultValue={c.address ?? ""} disabled={!isOwner} className={`${inp} h-auto py-2`} />
                </label>
                {isOwner && <div className="md:col-span-2"><PendingSubmit className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Kaydet</PendingSubmit></div>}
              </form>
            </Card>
          );
        })()}

        {tab === "subeler" && (
          <>
            {(branches ?? []).map((b) => (
              <Card key={b.id} title={b.name} action={<a href={`/kiosk/${b.id}`} target="_blank" className="text-[13px] font-semibold text-brand-700">QR kiosk ekranını aç</a>}>
                <BranchForm branch={b} />
                <p className="text-xs text-muted">{b.lat ? `Konum tanımlı · personel ${b.radius_m} m içindeyken telefondan giriş-çıkış yapabilir.` : "Konum tanımlı değil: mobil girişte sadece QR kod çalışır."} QR kiosk ekranını girişteki tablette açık bırakın; kod her saat değişir, fotoğrafı başka yerden okutulamaz.</p>
              </Card>
            ))}
            {isOwner && <Card title="Yeni şube"><BranchForm /></Card>}
          </>
        )}

        {tab === "bolumler" && (
          <Card title="Bölümler">
            {(departments ?? []).map((d) => (
              <div key={d.id} className="flex gap-2 items-center">
                <form action={saveDepartment} className="flex gap-2 items-center flex-1">
                  <input type="hidden" name="id" value={d.id} />
                  <input name="name" defaultValue={d.name} aria-label="Bölüm adı" className="h-10 rounded-lg border border-[#D5DEE8] px-3 flex-1 max-w-sm" />
                  <span className="text-xs text-muted w-20">{deptCount.get(d.id) ?? 0} kişi</span>
                  <button className="h-10 px-3 rounded-lg border border-[#D5DEE8] text-xs font-semibold text-brand-700">Kaydet</button>
                </form>
                {!deptCount.get(d.id) && <form action={deleteDepartment}><input type="hidden" name="id" value={d.id} /><ConfirmSubmit label="Sil" /></form>}
              </div>
            ))}
            <form action={saveDepartment} className="flex gap-2 items-center pt-2 border-t border-line">
              <input name="name" required placeholder="Yeni bölüm adı" className="h-10 rounded-lg border border-[#D5DEE8] px-3 flex-1 max-w-sm" />
              <button className="h-10 px-4 rounded-lg bg-brand-700 text-white text-sm font-semibold">Ekle</button>
            </form>
          </Card>
        )}

        {tab === "cihazlar" && (
          <Card title="PDKS cihazları">
            <p className="text-sm text-muted">Cihaz dosyasındaki ilk sütun (001, 002) hangi yönü gösteriyor. Varsayılan: 002 giriş, 001 çıkış.</p>
            {(devices.data ?? []).map((d) => (
              <div key={d.id} className="flex gap-2 items-center flex-wrap">
                <form action={saveDevice} className="flex gap-2 items-center flex-wrap">
                  <input type="hidden" name="id" value={d.id} />
                  <input name="code" defaultValue={d.code} aria-label="Cihaz kodu" className="h-10 w-20 rounded-lg border border-[#D5DEE8] px-3 font-mono" />
                  <select name="direction" defaultValue={d.direction} aria-label="Yön" className="h-10 rounded-lg border border-[#D5DEE8] px-2"><option value="IN">Giriş</option><option value="OUT">Çıkış</option></select>
                  <select name="branch_id" defaultValue={d.branch_id} aria-label="Şube" className="h-10 rounded-lg border border-[#D5DEE8] px-2">{(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                  <input name="name" defaultValue={d.name ?? ""} placeholder="Ad" aria-label="Cihaz adı" className="h-10 rounded-lg border border-[#D5DEE8] px-3" />
                  {isOwner && <button className="h-10 px-3 rounded-lg border border-[#D5DEE8] text-xs font-semibold text-brand-700">Kaydet</button>}
                </form>
                {isOwner && <form action={deleteDevice}><input type="hidden" name="id" value={d.id} /><ConfirmSubmit label="Sil" /></form>}
              </div>
            ))}
            {isOwner && (
              <form action={saveDevice} className="flex gap-2 items-center flex-wrap pt-2 border-t border-line">
                <input name="code" required placeholder="003" className="h-10 w-20 rounded-lg border border-[#D5DEE8] px-3 font-mono" />
                <select name="direction" className="h-10 rounded-lg border border-[#D5DEE8] px-2"><option value="IN">Giriş</option><option value="OUT">Çıkış</option></select>
                <select name="branch_id" className="h-10 rounded-lg border border-[#D5DEE8] px-2">{(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                <input name="name" placeholder="Ad" className="h-10 rounded-lg border border-[#D5DEE8] px-3" />
                <button className="h-10 px-4 rounded-lg bg-brand-700 text-white text-sm font-semibold">Cihaz ekle</button>
              </form>
            )}
          </Card>
        )}

      </div>
    </>
  );
}
