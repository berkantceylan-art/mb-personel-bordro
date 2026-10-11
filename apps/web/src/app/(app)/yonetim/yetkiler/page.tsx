import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, btnSecondary, page, td, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { saveModuleLevels } from "@/lib/users-actions";
import { TEMPLATES } from "@/lib/users";

export const dynamic = "force-dynamic";

const MODULES: [string, string][] = [["finance", "Finans"], ["sales", "Satış"], ["purchases", "Alış"], ["stock", "Stok"], ["production", "Üretim"], ["assets", "Demirbaş"], ["expenses", "Masraf"], ["users", "Kullanıcılar"]];
const LEVEL: [string, string, string][] = [["0", "Yok", "bg-[#EEF2F6] text-muted"], ["1", "Görür", "bg-[#EAF2FB] text-brand-700"], ["2", "Düzenler", "bg-warn-bg text-warn"], ["3", "Yönetir", "bg-ok-bg text-ok"]];
const ROLE: Record<string, string> = { owner: "Firma sahibi", accountant: "Muhasebe", hr: "İK", branch_manager: "Şef / müdür", safety: "İSG", employee: "Personel", site_editor: "Site editörü" };

type U = { user_id: string; display_name: string; role: string; email: string | null; last_sign_in_at: string | null; created_at: string; logistics: boolean; site_access: boolean; employee_id: string | null; levels: Record<string, number>; explicit: Record<string, number> };

/** Modül yetki matrisi: kim hangi ERP modülünde ne yapabilir */
export default async function PermissionsPage() {
  const s = await getSession();
  const lvl = s.modules.users ?? 0;
  if (lvl < 1 && !["owner", "hr"].includes(s.role)) redirect("/");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("users_overview");
  const users = (data ?? []) as U[];
  const can = lvl >= 3;
  const ago = (d: string | null) => { if (!d) return "hiç girmedi"; const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000); return days === 0 ? "bugün" : days === 1 ? "dün" : `${days} gün önce`; };

  return (
    <>
      <PageHeader title="Modül yetkileri" subtitle="Finans, satış, alış, stok, üretim, demirbaş, masraf ve kullanıcı yönetimi için kişi bazında yetki. Seçilmeyen hücre rolün varsayılanını kullanır."
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href="/yonetim/hareketler" className="text-brand-700">İşlem geçmişi</Link><Link href="/yonetim" className="text-brand-700">Kullanıcılar ve roller</Link></span>} />
      <div className={page}>
        {error && <Notice tone="bad">{/users_overview|schema cache/.test(error.message) ? "Supabase'de 20261208000000_users_admin.sql çalıştırılmalı." : error.message}</Notice>}
        <div className="flex flex-wrap gap-2 text-xs">
          {LEVEL.map(([k, l, c]) => <span key={k} className={`px-2 py-1 rounded-md font-semibold ${c}`}>{l}</span>)}
          <span className="text-muted self-center">· “Görür”: listeleri ve raporları görür · “Düzenler”: kayıt girer · “Yönetir”: iptal, ayar, yetki</span>
        </div>
        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm min-w-[1180px]">
            <thead><tr className="text-xs text-muted text-left"><th className={th}>Kullanıcı</th>{MODULES.map(([k, l]) => <th key={k} className={`${th} text-center`}>{l}</th>)}<th className={th}>Şablon</th><th className={th} /></tr></thead>
            <tbody>
              {users.map((u) => {
                const fid = `f-${u.user_id}`;
                const owner = u.role === "owner";
                return (
                  <tr key={u.user_id} className="align-middle">
                    <td className={td}>
                      <b>{u.display_name}</b>{u.user_id === s.userId && <span className="text-xs text-muted"> (siz)</span>}
                      <span className="block text-xs text-muted">{ROLE[u.role] ?? u.role}{u.logistics ? " · lab/kargo" : ""}{u.site_access ? " · site" : ""}</span>
                      <span className="block text-[11px] text-muted">{u.email ?? ""} · son giriş {ago(u.last_sign_in_at)}</span>
                    </td>
                    {MODULES.map(([k]) => {
                      const v = String(u.levels?.[k] ?? 0);
                      const exp = u.explicit?.[k] !== undefined;
                      const [, label, cls] = LEVEL.find((x) => x[0] === v) ?? LEVEL[0];
                      return (
                        <td key={k} className={`${td} text-center`}>
                          {can && !owner ? (
                            <select name={k} form={fid} defaultValue={exp ? v : "d"} className={`h-9 rounded-md border px-1 text-xs font-semibold ${exp ? "border-brand-600" : "border-[#D5DEE8]"} ${cls}`} aria-label={k}>
                              <option value="d">Varsayılan ({label})</option>
                              {LEVEL.map(([lv, l]) => <option key={lv} value={lv}>{l}</option>)}
                            </select>
                          ) : <span className={`px-2 py-1 rounded-md text-xs font-semibold ${cls}`}>{label}</span>}
                        </td>
                      );
                    })}
                    <td className={td}>
                      {can && !owner && (
                        <form action={saveModuleLevels} className="flex gap-1">
                          <input type="hidden" name="user_id" value={u.user_id} />
                          <select name="template" className="h-9 rounded-md border border-[#D5DEE8] px-1 text-xs" aria-label="Şablon"><option value="">Şablon seç</option>{Object.entries(TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</select>
                          <PendingSubmit className="text-xs font-semibold text-brand-700">Uygula</PendingSubmit>
                        </form>
                      )}
                    </td>
                    <td className={`${td} text-right`}>
                      {can && !owner && (
                        <form id={fid} action={saveModuleLevels}>
                          <input type="hidden" name="user_id" value={u.user_id} />
                          <PendingSubmit className={`${btnSecondary} h-9`}>Kaydet</PendingSubmit>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <p className="text-xs text-muted">Rol, şube ve laboratuvar/kargo erişimi <Link href="/yonetim" className="underline">Kullanıcılar ve roller</Link> sekmesinden değişir; buradaki ayar onların üzerine yazılır. Yeni kullanıcı davet kodu ile eklenir. Son güncelleme: {formatDate(new Date().toISOString())}.</p>
      </div>
    </>
  );
}
