import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { supInviteClaim } from "@/lib/supplier-invite-actions";
import { InviteForm } from "./InviteForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tedarikçi daveti", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Tedarikçi kullanıcı daveti: şifre belirleyip tedarikçi ekranına girer */
export default async function SupplierInvite({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ hata?: string }> }) {
  const { code } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = /^[0-9a-f]{32}$/.test(code) ? await supabase.rpc("sup_invite_info", { p_code: code }) : { data: null };
  const info = data as { name: string; email: string; party: string; company: string } | null;
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <main className="mx-auto max-w-[480px] p-4 md:p-10">
      <div className="rounded-[16px] bg-white border border-line p-6 flex flex-col gap-4">
        {!info ? (
          <>
            <h1 className="font-display text-xl font-bold text-brand-800">Davet geçersiz</h1>
            <p className="text-sm text-muted">Bu davet bağlantısının süresi dolmuş ya da kullanılmış. Firmadan yeni davet isteyin. Hesabınız varsa <Link href="/giris" className="font-semibold text-brand-700 underline">giriş yapın</Link>.</p>
          </>
        ) : (
          <>
            <div>
              <p className="text-xs font-semibold text-muted">TEDARİKÇİ EKRANI DAVETİ</p>
              <h1 className="font-display text-xl font-bold text-brand-800">{info.company}</h1>
              <p className="text-sm text-muted mt-1">{info.name} ({info.party}), {info.company} size verdiği siparişleri görmeniz, onaylamanız ve sevkiyatı bildirmeniz için hesap açtı.</p>
            </div>
            {sp.hata && <p className="text-sm rounded-lg px-3 py-2 bg-bad-bg text-bad">Bağlanamadı: giriş yaptığınız hesabın e-postası ({info.email}) ile aynı olmalı.</p>}
            {user ? (
              <form action={supInviteClaim} className="flex flex-col gap-2">
                <input type="hidden" name="code" value={code} />
                <p className="text-sm">Şu an <b>{user.email}</b> ile giriş yapılmış.</p>
                <button className="h-11 rounded-[10px] bg-brand-700 text-white font-bold">Hesabıma bağla</button>
              </form>
            ) : (
              <InviteForm code={code} email={info.email} />
            )}
          </>
        )}
      </div>
    </main>
  );
}
