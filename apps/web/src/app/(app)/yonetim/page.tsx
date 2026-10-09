import { formatInviteCode } from "@/lib/constants";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Tabs } from "@/components/Compliance";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { BranchForm, BulkInviteForm, InviteForm } from "./AdminForms";
import { deleteDepartment, deleteDevice, deleteInvite, removeMember, saveCompanyInfo, saveDepartment, saveDevice, updateMember } from "./actions";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

const ROLE: Record<string, string> = { owner: "Şirket sahibi", accountant: "Muhasebe", hr: "İnsan kaynakları", branch_manager: "Şube sorumlusu", safety: "İSG uzmanı", employee: "Personel", site_editor: "Web sitesi editörü" };
const TABLE: Record<string, string> = {
  employees: "Personel", employee_private: "Kişisel bilgi", pay_contracts: "Ücret", ledger_entries: "Cari hareket", attendance_punches: "Okutma", shifts: "Vardiya",
  leave_requests: "İzin", overtime_records: "Fazla mesai", payroll_lines: "Bordro", garnishment_files: "İcra", bes_enrollments: "BES", training_records: "Eğitim",
  health_exams: "Muayene", safety_incidents: "İş kazası", invites: "Davet", advance_requests: "Avans talebi",
};

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ sekme?: string; tablo?: string }> }) {
  const s = await getSession();
  if (!["owner", "hr"].includes(s.role)) redirect("/");
  const sp = await searchParams;
  const tab = ["kullanicilar", "davetler", "subeler", "bolumler", "cihazlar", "sirket", "denetim"].includes(sp.sekme ?? "") ? sp.sekme! : "kullanicilar";
  const supabase = await createClient();
  const isOwner = s.role === "owner";

  const [{ data: dir }, { data: branches }, { data: departments }, { data: emps }] = await Promise.all([
    supabase.rpc("company_directory"),
    supabase.from("branches").select("id, name, address, lat, lng, radius_m, mobile_punch_enabled").order("name"),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("employees").select("id, first_name, last_name, user_id, department_id").eq("status", "active").order("first_name"),
  ]);
  const [members, mb, invites, devices, company, audit] = await Promise.all([
    tab === "kullanicilar" ? supabase.from("memberships").select("user_id, role, all_branches, display_name, created_at").order("created_at") : Promise.resolve({ data: [] }),
    tab === "kullanicilar" ? supabase.from("membership_branches").select("user_id, branch_id") : Promise.resolve({ data: [] }),
    tab === "davetler" ? supabase.from("invites").select("*").order("created_at", { ascending: false }).limit(300) : Promise.resolve({ data: [] }),
    tab === "cihazlar" ? supabase.from("devices").select("*").order("code") : Promise.resolve({ data: [] }),
    tab === "sirket" ? supabase.from("companies").select("*").eq("id", s.companyId).maybeSingle() : Promise.resolve({ data: null }),
    tab === "denetim" && isOwner
      ? (() => { let q = supabase.from("audit_log").select("id, table_name, row_id, action, old_data, new_data, actor, at").order("at", { ascending: false }).limit(200); if (sp.tablo) q = q.eq("table_name", sp.tablo); return q; })()
      : Promise.resolve({ data: [] }),
  ]);
  const dirByUser = new Map(((dir ?? []) as Array<{ user_id: string; display_name: string; employee_id: string | null; department: string | null }>).map((d) => [d.user_id, d]));
  const empName = new Map((emps ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const deptCount = new Map<string, number>();
  for (const e of emps ?? []) if (e.department_id) deptCount.set(e.department_id, (deptCount.get(e.department_id) ?? 0) + 1);
  const withAccount = (emps ?? []).filter((e) => e.user_id).length;
  const th = "py-3 px-3 font-semibold border-b border-line";
  const td = "py-2.5 px-3 border-b border-[#EEF2F6]";

  return (
    <>
      <PageHeader title="Yönetim paneli" subtitle={`${(dir ?? []).length} kullanıcı · ${withAccount}/${(emps ?? []).length} personelin mobil hesabı var`} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1320px]">
        <Tabs base="/yonetim" active={tab} tabs={[["kullanicilar", "Kullanıcılar ve roller"], ["davetler", "Davet kodları"], ["subeler", "Şubeler ve konum"], ["bolumler", "Bölümler"], ["cihazlar", "PDKS cihazları"], ["sirket", "Şirket bilgileri"], ...(isOwner ? [["denetim", "Denetim kaydı"] as [string, string]] : [])]} />

        {tab === "kullanicilar" && (
          <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead><tr className="text-left text-xs text-muted"><th className={th}>Kullanıcı</th><th className={th}>Bağlı personel</th><th className={th}>Rol ve şube yetkisi</th><th className={th}><span className="sr-only">İşlem</span></th></tr></thead>
              <tbody>
                {(members.data ?? []).map((m) => {
                  const d = dirByUser.get(m.user_id);
                  const myBranches = new Set((mb.data ?? []).filter((x) => x.user_id === m.user_id).map((x) => x.branch_id));
                  return (
                    <tr key={m.user_id}>
                      <td className={td}><b>{d?.display_name ?? m.display_name ?? "—"}</b><span className="block text-xs text-muted">{m.user_id === s.userId ? "siz · " : ""}{formatDate(m.created_at)}</span></td>
                      <td className={td}>{d?.employee_id ? <Link href={`/personel/${d.employee_id}`} className="text-brand-700 font-semibold">{empName.get(d.employee_id) ?? "Personel"}</Link> : <span className="text-muted">—</span>}{d?.department ? <span className="block text-xs text-muted">{d.department}</span> : null}</td>
                      <td className={td}>
                        {isOwner ? (
                          <form action={updateMember} className="flex flex-wrap gap-2 items-center">
                            <input type="hidden" name="userId" value={m.user_id} />
                            <input name="display_name" defaultValue={m.display_name ?? ""} placeholder="Görünen ad" aria-label="Görünen ad" className="h-9 w-36 rounded-md border border-[#D5DEE8] px-2 text-xs" />
                            <select name="role" defaultValue={m.role} aria-label="Rol" className="h-9 rounded-md border border-[#D5DEE8] px-2 text-xs">{Object.entries(ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                            <label className="flex gap-1 items-center text-xs"><input type="checkbox" name="all_branches" defaultChecked={m.all_branches} />Tüm şubeler</label>
                            {(branches ?? []).length > 1 && (branches ?? []).map((b) => (
                              <label key={b.id} className="flex gap-1 items-center text-xs"><input type="checkbox" name="branch_id" value={b.id} defaultChecked={myBranches.has(b.id)} />{b.name}</label>
                            ))}
                            <button className="h-9 px-3 rounded-md border border-[#D5DEE8] text-xs font-semibold text-brand-700">Kaydet</button>
                          </form>
                        ) : (
                          <span>{ROLE[m.role]}{m.all_branches ? " · tüm şubeler" : ""}</span>
                        )}
                      </td>
                      <td className={`${td} text-right`}>
                        {isOwner && m.user_id !== s.userId && (
                          <form action={removeMember}><input type="hidden" name="userId" value={m.user_id} /><ConfirmSubmit label="Erişimi kaldır" question="Kullanıcının erişimi kaldırılsın mı?" /></form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-muted p-3">Roller: <b>Şirket sahibi</b> her şey · <b>Muhasebe</b> ücret, ödeme, bordro · <b>İK</b> personel, puantaj, izin · <b>Şube sorumlusu</b> kendi şubesinin puantaj/vardiya/izinleri · <b>İSG uzmanı</b> eğitim ve sağlık · <b>Personel</b> sadece kendi bilgileri (mobil).</p>
          </section>
        )}

        {tab === "davetler" && (
          <>
            <Card title="Tek davet"><InviteForm employees={(emps ?? []).filter((e) => !e.user_id).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}` }))} isOwner={isOwner} /></Card>
            <Card title="Toplu davet (personel mobil uygulaması)">
              <p className="text-sm text-muted">Her personele kişisel kod üretilir. Personel uygulamada &quot;Hesap oluştur&quot; deyip kodu ve kendi belirlediği şifreyi girer; giriş için PDKS numarasını (veya e-postasını) kullanır.</p>
              <BulkInviteForm departments={departments ?? []} />
            </Card>
            <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead><tr className="text-left text-xs text-muted"><th className={th}>Kod</th><th className={th}>Kişi</th><th className={th}>Rol</th><th className={th}>Giriş kimliği</th><th className={th}>Durum</th><th className={th}><span className="sr-only">Sil</span></th></tr></thead>
                <tbody>
                  {(invites.data ?? []).map((i) => (
                    <tr key={i.id}>
                      <td className={`${td} font-mono font-bold tracking-widest`}>{formatInviteCode(i.code)}</td>
                      <td className={td}>{i.display_name ?? (i.employee_id ? empName.get(i.employee_id) : "—")}</td>
                      <td className={td}>{ROLE[i.role]}</td>
                      <td className={`${td} text-xs`}>{i.login_email}</td>
                      <td className={td}>{i.used_at ? <span className="text-xs font-semibold text-ok">Kullanıldı {formatDate(i.used_at)}</span> : new Date(i.expires_at) < new Date() ? <span className="text-xs text-bad">Süresi doldu</span> : <span className="text-xs text-warn">Bekliyor · {formatDate(i.expires_at)}&apos;e kadar</span>}</td>
                      <td className={`${td} text-right`}>{!i.used_at && <form action={deleteInvite}><input type="hidden" name="id" value={i.id} /><ConfirmSubmit label="Sil" /></form>}</td>
                    </tr>
                  ))}
                  {(invites.data ?? []).length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">Davet yok.</td></tr>}
                </tbody>
              </table>
            </section>
          </>
        )}

        {tab === "sirket" && (() => {
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

        {tab === "denetim" && isOwner && (
          <>
            <form className="flex gap-2">
              <input type="hidden" name="sekme" value="denetim" />
              <select name="tablo" defaultValue={sp.tablo ?? ""} aria-label="Kayıt türü" className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3">
                <option value="">Tüm kayıtlar</option>{Object.entries(TABLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Filtrele</button>
            </form>
            <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
              <table className="w-full text-xs min-w-[900px]">
                <thead><tr className="text-left text-muted"><th className={th}>Zaman</th><th className={th}>Kim</th><th className={th}>Kayıt</th><th className={th}>İşlem</th><th className={th}>Değişen alanlar</th></tr></thead>
                <tbody>
                  {(audit.data ?? []).map((a) => {
                    const oldD = (a.old_data ?? {}) as Record<string, unknown>;
                    const newD = (a.new_data ?? {}) as Record<string, unknown>;
                    const changed = a.action === "UPDATE" ? Object.keys(newD).filter((k) => JSON.stringify(newD[k]) !== JSON.stringify(oldD[k]) && !["updated_at"].includes(k)) : [];
                    return (
                      <tr key={a.id}>
                        <td className={`num ${td} whitespace-nowrap`}>{new Date(a.at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</td>
                        <td className={td}>{a.actor ? dirByUser.get(a.actor)?.display_name ?? "—" : "sistem"}</td>
                        <td className={td}>{TABLE[a.table_name] ?? a.table_name}</td>
                        <td className={td}>{a.action === "INSERT" ? "Ekleme" : a.action === "UPDATE" ? "Değişiklik" : "Silme"}</td>
                        <td className={`${td} font-mono`}>{changed.slice(0, 6).map((k) => `${k}: ${JSON.stringify(oldD[k])} → ${JSON.stringify(newD[k])}`).join(" · ")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </>
  );
}
