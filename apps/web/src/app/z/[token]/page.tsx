import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { AutoReload } from "./AutoReload";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ziyaret davetiyesi", robots: { index: false } };

/** Ziyaretçi davetiyesi (giriş gerekmez): girişte güvenliğe gösterilen QR */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{24}$/.test(token)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.rpc("vis_public", { p_token: token });
  if (!data) notFound();
  const v = data as { name: string; company: string; host: string | null; target?: string | null; expected_at: string | null; status: string; no: string; purpose: string | null; reason?: string | null; source?: string; address?: string | null; phone?: string | null };
  const pendingReq = v.status === "requested";
  const rejected = v.status === "rejected";
  const walkin = v.source === "walkin";
  const qr = await QRCode.toString(token, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return (
    <main className="min-h-screen bg-[#0F2A47] p-4 text-white">
      <div className="mx-auto flex max-w-sm flex-col items-center gap-4 pt-8 text-center">
        <span className="text-sm uppercase tracking-widest text-white/70">{v.company}</span>
        <h1 className="text-2xl font-bold">{pendingReq ? (walkin ? "Kaydınız alındı" : "Randevu talebiniz alındı") : rejected ? (walkin ? "Giriş talebi" : "Randevu talebi") : walkin ? "Giriş kartınız" : "Ziyaret davetiyesi"}</h1>
        <div className="w-full rounded-3xl bg-white p-6 text-ink shadow-2xl">
          {pendingReq ? (
            <div className="py-6"><span className="text-5xl">⏳</span><p className="mt-3 font-semibold">Onay bekleniyor</p><p className="text-sm text-muted">{walkin ? `${v.target ? `${v.target} ya da güvenlik` : "Güvenlik"} onaylayınca giriş QR'ınız burada çıkar. Lütfen bekleyin, bu sayfayı kapatmayın.` : `${v.target ? `${v.target} talebinizi inceliyor.` : "Talebiniz inceleniyor."} Onaylanınca bu sayfada QR davetiyeniz görünür; sayfayı kaydedin.`}</p><AutoReload seconds={walkin ? 5 : 30} /></div>
          ) : rejected ? (
            <div className="py-6"><span className="text-5xl">📅</span><p className="mt-3 font-semibold text-bad">Bu saat için uygun değil</p>{v.reason && <p className="text-sm text-muted">{v.reason}</p>}<p className="mt-2 text-sm">{walkin ? "Ayrıntı için güvenlik görevlisiyle görüşün." : "Sitemizden başka bir gün / saat için yeniden randevu isteyebilirsiniz."}</p></div>
          ) : (
            <span className="mx-auto block w-56 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
          )}
          <b className="mt-3 block text-xl">{v.name}</b>
          <span className="block font-mono text-sm text-muted">{v.no}</span>
          {v.expected_at && <span className="mt-1 block text-sm">{new Date(v.expected_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "full", timeStyle: "short" })}</span>}
          {v.host && <span className="block text-sm text-muted">Görüşülecek kişi: {v.host}</span>}
          {v.status === "in" && <span className="mt-2 block font-semibold text-ok">İçeridesiniz</span>}
          {v.status === "out" && <span className="mt-2 block font-semibold text-muted">Ziyaret tamamlandı</span>}
        </div>
        {!pendingReq && !rejected && <p className="text-sm text-white/80">{walkin && v.status === "expected" ? "✅ Onaylandı. " : ""}Girişte bu kodu güvenlik görevlisine gösterin. Ziyaret kayıtları KVKK kapsamında yalnız güvenlik amacıyla tutulur.</p>}
        {(v.address || v.phone) && <p className="text-xs text-white/70">{[v.address, v.phone].filter(Boolean).join(" · ")}</p>}
      </div>
    </main>
  );
}
