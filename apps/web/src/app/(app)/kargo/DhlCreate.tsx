"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RateRow } from "@/lib/dhl-actions";

type Prefill = {
  id: string; no: number; direction: "in" | "out";
  company: string; name: string; address1: string; address2: string; city: string; postal: string; country: string; phone: string; email: string;
  weight: number; length: number; width: number; height: number; packages: number; value: number; currency: string; description: string; testMode: boolean; importReady: boolean;
};
const input = "h-10 rounded-[10px] border border-[#D5DEE8] px-3 bg-white w-full text-sm";
const label = "flex flex-col gap-1 text-xs font-semibold text-muted";
const COUNTRIES: [string, string][] = [["FR", "Fransa"], ["BE", "Belçika"], ["CH", "İsviçre"], ["LU", "Lüksemburg"], ["DE", "Almanya"], ["NL", "Hollanda"], ["GB", "İngiltere"], ["IT", "İtalya"], ["ES", "İspanya"], ["AT", "Avusturya"], ["MC", "Monako"], ["CA", "Kanada"], ["US", "ABD"], ["MA", "Fas"], ["DZ", "Cezayir"], ["TN", "Tunus"], ["TR", "Türkiye"]];

/** DHL'de gönderi aç (giden: biz → hekim; gelen: hekimden alım, ithalat hesabımızla) — fiyat sor + oluştur */
export function DhlCreate({ p, quote, create }: { p: Prefill; quote: (f: FormData) => Promise<{ ok: boolean; message?: string; rates?: RateRow[] }>; create: (f: FormData) => Promise<{ ok: boolean; message: string }> }) {
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rates, setRates] = useState<RateRow[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [product, setProduct] = useState("");
  const mode = p.direction === "in" ? "import" : "export";
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const run = (fn: "quote" | "create") => {
    if (!ref.current) return;
    const fd = new FormData(ref.current);
    setMsg(null);
    start(async () => {
      if (fn === "quote") {
        const r = await quote(fd);
        if (r.ok) setRates(r.rates ?? []); else setMsg({ ok: false, text: r.message ?? "Hata" });
      } else {
        const r = await create(fd);
        setMsg({ ok: r.ok, text: r.message });
        if (r.ok) router.refresh();
      }
    });
  };
  if (mode === "import" && !p.importReady) {
    return <p className="text-sm text-muted">Hekimden DHL ile alım (ithalat) gönderisi açmak için Vercel&apos;e <b>DHL_IMPORT_ACCOUNT_NO</b> (DHL ithalat hesap no) eklenmeli. Hekim kendi DHL&apos;iyle gönderdiyse takip numarasını girmeniz yeterli; durum otomatik izlenir.</p>;
  }
  return (
    <form ref={ref} onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={p.id} />
      <input type="hidden" name="no" value={p.no} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="product_code" value={product} />
      {p.testMode && <p className="text-xs font-semibold rounded-lg bg-warn-bg text-warn px-3 py-2">TEST modu: oluşturulan gönderiler gerçek değildir. Canlıya geçmek için Kargo › DHL ayarları.</p>}
      <p className="text-xs text-muted">{mode === "export" ? "Alıcı (hekim / klinik)" : "Paketi alınacak yer (hekim / klinik) — DHL kuryesi oradan alıp bize getirir, ücret ithalat hesabımızdan"}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={label}>Klinik / firma<input name="r_company" defaultValue={p.company} className={input} /></label>
        <label className={label}>Ad soyad *<input name="r_name" required defaultValue={p.name} className={input} /></label>
        <label className={`${label} sm:col-span-2`}>Adres *<input name="r_address1" required defaultValue={p.address1} maxLength={45} className={input} /></label>
        <label className={`${label} sm:col-span-2`}>Adres 2<input name="r_address2" defaultValue={p.address2} maxLength={45} className={input} /></label>
        <label className={label}>Posta kodu *<input name="r_postal" required defaultValue={p.postal} className={`${input} num`} /></label>
        <label className={label}>Şehir *<input name="r_city" required defaultValue={p.city} className={input} /></label>
        <label className={label}>Ülke *
          <select name="r_country" defaultValue={p.country || "FR"} className={input}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}</select>
        </label>
        <label className={label}>Telefon *<input name="r_phone" required defaultValue={p.phone} className={input} /></label>
        <label className={`${label} sm:col-span-2`}>E-posta (DHL bildirimi)<input name="r_email" type="email" defaultValue={p.email} className={input} /></label>
      </div>
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-5">
        <label className={label}>Ağırlık kg<input name="weight" defaultValue={p.weight} inputMode="decimal" className={`${input} num`} /></label>
        <label className={label}>Boy cm<input name="length" defaultValue={p.length} inputMode="numeric" className={`${input} num`} /></label>
        <label className={label}>En cm<input name="width" defaultValue={p.width} inputMode="numeric" className={`${input} num`} /></label>
        <label className={label}>Yükseklik cm<input name="height" defaultValue={p.height} inputMode="numeric" className={`${input} num`} /></label>
        <label className={label}>Koli<input name="packages" defaultValue={p.packages} inputMode="numeric" className={`${input} num`} /></label>
      </div>
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <label className={label}>Beyan değeri<input name="value" defaultValue={p.value} inputMode="decimal" className={`${input} num`} /></label>
        <label className={label}>Para birimi<select name="currency" defaultValue={p.currency} className={input}><option>EUR</option><option>USD</option><option>TRY</option><option>CHF</option><option>GBP</option></select></label>
        <label className={label}>Fatura no<input name="invoice_no" defaultValue={`G${p.no}`} className={input} /></label>
        <label className={label}>Gönderim tarihi<input name="ship_date" type="date" defaultValue={today} min={today} className={input} /></label>
        <label className={`${label} col-span-2 sm:col-span-4`}>İçerik açıklaması (gümrük)<input name="description" defaultValue={p.description} className={input} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pickup" defaultChecked={mode === "import"} className="w-4 h-4 accent-[#0A3D73]" />DHL kuryesi çağır {mode === "export" ? "(laboratuvardan alsın)" : "(hekimden alsın)"}</label>
      <div className="grid gap-2 grid-cols-2 max-w-xs">
        <label className={label}>Hazır saati<input name="pickup_ready" type="time" defaultValue="14:00" className={input} /></label>
        <label className={label}>Kapanış saati<input name="pickup_close" type="time" defaultValue="18:00" className={input} /></label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => run("quote")} className="h-10 px-4 rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold text-sm disabled:opacity-50">{pending ? "…" : "Fiyat sor"}</button>
        <button type="button" disabled={pending} onClick={() => run("create")} className="h-10 px-4 rounded-[10px] bg-[#FFCC00] text-[#D40511] font-bold text-sm disabled:opacity-50">{pending ? "DHL'e gönderiliyor…" : "DHL gönderisi oluştur + etiket"}</button>
      </div>
      {rates && (
        <ul className="flex flex-col gap-1.5">
          {rates.length === 0 && <li className="text-sm text-muted">Bu güzergâh için ürün bulunamadı.</li>}
          {rates.map((r) => (
            <li key={r.code}>
              <label className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer ${product === r.code ? "border-brand-700 bg-[#F3F8FD]" : "border-line"}`}>
                <input type="radio" name="pick" checked={product === r.code} onChange={() => setProduct(r.code)} className="accent-[#0A3D73]" />
                <span className="flex-1"><b>{r.name}</b> <span className="text-xs text-muted">({r.code}){r.eta ? ` · tahmini teslim ${r.eta.split("-").reverse().join(".")}` : ""}{r.days ? ` · ${r.days} gün` : ""}</span></span>
                <b className="num">{r.price != null ? `${r.price.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${r.currency ?? ""}` : "—"}</b>
              </label>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}</p>}
    </form>
  );
}
