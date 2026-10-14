import { createClient } from "@/lib/supabase/server";
import { WalkinForm } from "./WalkinForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ziyaretçi girişi", robots: { index: false } };

/** Kapıdaki QR afişinden açılan randevusuz ziyaretçi kaydı (giriş gerekmez) */
export default async function WalkinPage() {
  const supabase = await createClient();
  const { data: hosts } = await supabase.rpc("vis_hosts_public");
  return (
    <main className="min-h-screen bg-[#0F2A47] p-4 text-white">
      <div className="mx-auto flex max-w-md flex-col gap-4 pt-6">
        <div className="text-center">
          <span className="text-5xl">🚪</span>
          <h1 className="mt-2 text-2xl font-bold">Hoş geldiniz</h1>
          <p className="text-sm text-white/75">Randevunuz yoksa bilgilerinizi girin. Görüşeceğiniz kişi ya da güvenlik onaylayınca telefonunuzda giriş QR&apos;ınız açılır.</p>
        </div>
        <div className="rounded-3xl bg-white p-5 text-ink shadow-2xl">
          <WalkinForm hosts={((hosts ?? []) as Array<{ id: string; label: string; description: string | null }>)} />
        </div>
        <p className="text-center text-xs text-white/60">Randevunuz varsa davetiyenizdeki QR&apos;ı güvenliğe göstermeniz yeterli.</p>
      </div>
    </main>
  );
}
