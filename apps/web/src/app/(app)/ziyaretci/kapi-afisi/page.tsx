import { headers } from "next/headers";
import QRCode from "qrcode";
import { PrintButton } from "@/components/PrintButton";
import { erpUrl } from "@/lib/po-send";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kapı QR afişi" };

/** Girişe asılacak A4 afiş: randevusuz ziyaretçi QR'ı okutup telefondan kayıt olur */
export default async function DoorPoster() {
  const h = await headers();
  const base = erpUrl() || `https://${h.get("host") ?? ""}`;
  const url = `${base}/z/kapi`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  const supabase = await createClient();
  const { data: co } = await supabase.from("companies").select("name").limit(1).maybeSingle();
  return (
    <div className="p-4 md:p-8 flex flex-col items-center gap-4">
      <div className="print:hidden flex gap-3 items-center"><PrintButton /><span className="text-sm text-muted">A4 yazdırıp girişe asın.</span></div>
      <article className="w-full max-w-[680px] aspect-[1/1.414] rounded-[24px] border-2 border-brand-700 bg-white p-10 flex flex-col items-center justify-between text-center print:border-0 print:rounded-none print:max-w-none">
        <div>
          <p className="text-sm uppercase tracking-[.3em] text-muted">{(co?.name as string) ?? ""}</p>
          <h1 className="mt-3 font-display text-4xl font-bold text-brand-800">Ziyaretçi girişi</h1>
          <p className="mt-3 text-lg text-ink">Randevunuz yoksa telefonunuzun kamerasıyla okutun,<br />bilgilerinizi girin; onaylanınca giriş QR&apos;ınız açılır.</p>
        </div>
        <span className="block w-[58%] [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
        <div className="flex flex-col gap-2">
          <div className="flex justify-center gap-6 text-sm font-semibold text-brand-800"><span>📦 Tedarikçi</span><span>🤝 Müşteri</span><span>🦷 Hekim</span><span>👤 Misafir</span></div>
          <p className="text-sm text-muted">Randevunuz varsa davetiyenizdeki QR&apos;ı güvenliğe gösterin.</p>
          <p className="font-mono text-xs text-muted">{url}</p>
        </div>
      </article>
    </div>
  );
}
