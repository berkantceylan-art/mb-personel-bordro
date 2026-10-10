import { PageHead } from "@/components/admin/ui";
import { MfaSetup } from "./MfaSetup";

export const metadata = { title: "Hesap güvenliği" };

export default function SecurityPage() {
  return (
    <>
      <PageHead title="Hesap güvenliği" lead="Yönetim paneline girişte şifreye ek olarak telefonunuzdaki doğrulayıcı uygulamanın kodu istenir. Şifreniz ele geçse bile paneliniz korunur." />
      <section className="max-w-2xl rounded-2xl border border-gypsum bg-white p-6">
        <h2 className="display mb-4 text-xl font-semibold text-navy">İki adımlı doğrulama (2FA)</h2>
        <MfaSetup />
        <p className="mt-6 text-xs text-slate">Telefonunuzu kaybederseniz şirket sahibi Supabase panelinden (Authentication → Users → kullanıcı → MFA) doğrulayıcıyı sıfırlayabilir.</p>
      </section>
    </>
  );
}
