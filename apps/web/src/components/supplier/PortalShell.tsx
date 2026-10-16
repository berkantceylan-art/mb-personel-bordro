import Link from "next/link";
import { SignOutForm } from "@/components/SignOut";
import { withQ, type PortalCtx } from "@/lib/supplier-portal";

const NAV: [string, string, string][] = [
  ["/tedarikci", "Özet", "◎"],
  ["/tedarikci/siparisler", "Siparişler", "▤"],
  ["/tedarikci/mesajlar", "Mesajlar", "✉"],
  ["/tedarikci/belgeler", "Belgeler", "⎘"],
  ["/tedarikci/urunler", "Ürünler ve fiyat", "₺"],
  ["/tedarikci/cari", "Cari hesap", "≡"],
  ["/tedarikci/odemeler", "Ödeme takvimi", "◷"],
];

/** Tedarikçi portalı çerçevesi: üst bant, sekmeler, önizleme uyarısı */
export function PortalShell({ ctx, active, badges = {}, children }: { ctx: PortalCtx; active: string; badges?: Record<string, number>; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      {ctx.mode === "preview" && (
        <div className="bg-[#FFF4E0] text-warn text-sm px-4 py-2 flex flex-wrap items-center gap-2 print:hidden">
          <b>Önizleme:</b> {ctx.party.name} tedarikçisinin gördüğü ekran. Burada yazdığınız mesaj ve yüklediğiniz belge laboratuvar adına gider.
          <Link href={`/satinalma/tedarikci/${ctx.party.id}`} className="ml-auto font-semibold underline">ERP&apos;deki tedarikçi sayfasına dön</Link>
        </div>
      )}
      <header className="bg-gradient-to-br from-[#072a50] via-[#0a3d73] to-[#0f6aa8] text-white print:hidden">
        <div className="mx-auto max-w-[1200px] px-4 md:px-8 pt-5 pb-0 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 grid place-items-center font-display font-bold">MB</div>
            <div className="flex-1 min-w-[200px]">
              <p className="text-[11px] tracking-[0.18em] font-semibold text-white/60">MB DENTAL · TEDARİKÇİ PORTALI</p>
              <h1 className="font-display text-xl md:text-2xl font-bold leading-tight">{ctx.party.name}</h1>
            </div>
            {ctx.parties.length > 1 && (
              <form className="flex items-center gap-1">
                <select name="cari" defaultValue={ctx.party.id} className="h-9 rounded-lg bg-white/10 border border-white/20 px-2 text-sm">
                  {ctx.parties.map((p) => <option key={p.id} value={p.id} className="text-ink">{p.name}</option>)}
                </select>
                <button className="h-9 px-3 rounded-lg bg-white/15 text-sm font-semibold">Geç</button>
              </form>
            )}
            {ctx.mode === "supplier" && <><span className="text-sm text-white/70 hidden sm:inline">{ctx.me}</span><SignOutForm buttonClassName="h-9 px-3 rounded-lg bg-white/10 border border-white/20 text-sm font-semibold" /></>}
          </div>
          <nav className="flex gap-1 overflow-x-auto -mb-px">
            {NAV.map(([href, label, icon]) => {
              const on = active === href;
              const b = badges[href] ?? 0;
              return (
                <Link key={href} href={withQ(href, ctx.q)} className={`shrink-0 h-11 px-4 inline-flex items-center gap-2 rounded-t-xl text-sm font-semibold transition ${on ? "bg-[#F4F7FA] text-brand-800" : "text-white/80 hover:bg-white/10"}`}>
                  <span aria-hidden className="opacity-70">{icon}</span>{label}
                  {b > 0 && <span className={`min-w-5 h-5 px-1 rounded-full text-[11px] grid place-items-center ${on ? "bg-bad text-white" : "bg-[#FF6B5B] text-white"}`}>{b}</span>}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1200px] p-4 md:p-8 flex flex-col gap-5">{children}</main>
    </div>
  );
}

/** Portal bağlı değilken */
export function NotLinked() {
  return (
    <main className="mx-auto max-w-[640px] p-6">
      <div className="rounded-[16px] bg-white border border-line p-6 flex flex-col gap-3">
        <h1 className="font-display text-xl font-bold text-brand-800">Tedarikçi ekranı</h1>
        <p className="text-sm text-muted">Bu hesap bir tedarikçiye bağlı değil ya da erişimi kapatılmış. Size gönderilen davet bağlantısını açın veya firmayla iletişime geçin.</p>
        <SignOutForm buttonClassName="h-10 px-4 rounded-[10px] border border-[#D5DEE8] font-semibold" />
      </div>
    </main>
  );
}
