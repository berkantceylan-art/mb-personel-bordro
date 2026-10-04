import { redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { PERSONNEL_DOMAIN, formatInviteCode } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PrintInvites() {
  const s = await getSession();
  if (!["owner", "hr"].includes(s.role)) redirect("/");
  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("invites")
    .select("code, display_name, login_email, expires_at, employees(card_no, departments(name))")
    .eq("role", "employee")
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("display_name");
  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white">
      <style>{`@page { size: A4; margin: 10mm; } .slip { break-inside: avoid; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-6 py-3 flex items-center gap-4">
        <span className="font-semibold">Personel davet kartları · {(inv ?? []).length} kişi</span>
        <PrintButton />
      </div>
      <div className="max-w-[190mm] mx-auto py-6 print:py-0 grid grid-cols-2 gap-3">
        {(inv ?? []).map((i) => {
          const e = i.employees as unknown as { card_no: string | null; departments: { name: string } | null } | null;
          const login = i.login_email.endsWith(`@${PERSONNEL_DOMAIN}`) ? i.login_email.split("@")[0] : i.login_email;
          return (
            <div key={i.code} className="slip bg-white border border-dashed border-[#9AA6B2] rounded-lg p-4 text-[12px] text-[#14202E]">
              <div className="flex items-center gap-2 mb-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.svg" alt="" className="w-8 h-8 object-contain" />
                <b className="text-[13px]">MB Personel uygulaması</b>
              </div>
              <div className="font-semibold text-[14px]">{i.display_name}</div>
              <div className="text-[#5A6878]">{e?.departments?.name ?? ""}</div>
              <div className="mt-2 grid grid-cols-[90px_1fr] gap-y-1">
                <span className="text-[#5A6878]">Davet kodu</span><b className="font-mono text-[18px] tracking-[0.12em] whitespace-nowrap">{formatInviteCode(i.code)}</b>
                <span className="text-[#5A6878]">Kullanıcı adı</span><b className="font-mono">{login}</b>
                <span className="text-[#5A6878]">Son geçerlilik</span><span>{formatDate(i.expires_at)}</span>
              </div>
              <ol className="mt-2 list-decimal pl-4 text-[11px] text-[#33414F]">
                <li>Uygulamayı açın, &quot;Hesap oluştur&quot;a dokunun.</li>
                <li>Davet kodunu girin ve kendinize bir şifre belirleyin.</li>
                <li>Sonraki girişlerde kullanıcı adınız ve şifrenizle girin.</li>
              </ol>
            </div>
          );
        })}
        {(inv ?? []).length === 0 && <p className="col-span-2 text-center text-[#5A6878]">Bekleyen personel daveti yok. Yönetim → Davet kodları&apos;ndan üretin.</p>}
      </div>
    </main>
  );
}
