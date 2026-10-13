import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/jobs";
import { RevenueTable, type RevCustomer } from "./RevenueTable";

type SB = Awaited<ReturnType<typeof createClient>>;
type Rev = {
  from: string; to: string; prev_from: string; prev_to: string; bucket: "day" | "month" | "year"; basis: string;
  total_try: number; prev_try: number; jobs: number; prev_jobs: number; units: number; customers: number; prev_customers: number; collected_try: number;
  series: Array<{ b: string; try: number; jobs: number }>; prev_series: Array<{ i: number; try: number }>;
  by_kind: Array<{ kind: string; try: number; customers: number; jobs: number }>;
  by_customer: RevCustomer[];
  by_product: Array<{ name: string; qty: number; try: number }>;
  lost: Array<{ id: string; name: string; kind: string; prev_try: number }>;
};
export type RevParams = { aralik?: string; bas?: string; bit?: string; esas?: string; tur?: string };

export const KIND: Record<string, [string, string]> = {
  doctor_tr: ["Hekim", "#3B82F6"], doctor_foreign: ["Yurt dışı hekim", "#8B5CF6"], clinic: ["Klinik", "#10B981"], hospital: ["Hastane", "#F59E0B"], agency: ["Aracı kurum", "#EC4899"],
};
const TL = (v: number) => money(v, "TRY");
const short = (v: number) => {
  const t = v / 100;
  return t >= 1_000_000 ? `${(t / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} M` : t >= 1000 ? `${(t / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} B` : t.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
};
const iso = (x: Date) => x.toISOString().slice(0, 10);
const addD = (s: string, n: number) => iso(new Date(Date.parse(`${s}T12:00:00Z`) + n * 86400000));
const dt = (s: string) => s.slice(0, 10).split("-").reverse().join(".");
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);
const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

export function revRange(today: string, p: RevParams): { from: string; to: string; key: string } {
  const k = p.aralik ?? "ay";
  if (k === "ozel" && p.bas && p.bit && /^\d{4}-\d{2}-\d{2}$/.test(p.bas) && /^\d{4}-\d{2}-\d{2}$/.test(p.bit)) return p.bas <= p.bit ? { from: p.bas, to: p.bit, key: k } : { from: p.bit, to: p.bas, key: k };
  if (k === "bugun") return { from: today, to: today, key: k };
  if (k === "dun") return { from: addD(today, -1), to: addD(today, -1), key: k };
  if (k === "hafta") return { from: addD(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7)), to: today, key: k };
  if (k === "son30") return { from: addD(today, -29), to: today, key: k };
  if (k === "gecenay") { const first = `${today.slice(0, 8)}01`; const last = addD(first, -1); return { from: `${last.slice(0, 8)}01`, to: last, key: k }; }
  if (k === "ceyrek") { const m = Number(today.slice(5, 7)); const qm = String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0"); return { from: `${today.slice(0, 4)}-${qm}-01`, to: today, key: k }; }
  if (k === "yil") return { from: `${today.slice(0, 4)}-01-01`, to: today, key: k };
  return { from: `${today.slice(0, 8)}01`, to: today, key: "ay" };
}

/** Müşteri ciroları: /ciro sayfası ve patron ekranı "Ciro" sekmesi aynı görünümü kullanır */
export async function RevenueView({ sb, today, p, base }: { sb: SB; today: string; p: RevParams; base: string }) {
  const r = revRange(today, p);
  const basis = p.esas === "teslim" ? "delivered" : "in";
  const kind = p.tur && KIND[p.tur] ? p.tur : "";
  const { data, error } = await sb.rpc("rev_report", { p_from: r.from, p_to: r.to, p_basis: basis, p_kind: kind || null });
  if (error) {
    return <p className="text-sm rounded-[12px] px-4 py-3 bg-warn-bg text-warn">{/rev_report|does not exist/.test(error.message) ? "Supabase'de 20270124000000_revenue.sql çalıştırılmalı." : /not_allowed/.test(error.message) ? "Bu ekran için yetkiniz yok." : error.message}</p>;
  }
  const v = data as Rev;
  const q = (over: Partial<RevParams & { aralik: string }>) => {
    const m = { aralik: r.key, bas: r.key === "ozel" ? r.from : undefined, bit: r.key === "ozel" ? r.to : undefined, esas: p.esas, tur: kind || undefined, ...over };
    const s = Object.entries(m).filter(([, x]) => x).map(([k2, x]) => `${k2}=${encodeURIComponent(String(x))}`).join("&");
    return `${base}${base.includes("?") ? "&" : "?"}${s}`;
  };
  const ch = pct(v.total_try, v.prev_try);
  const avg = v.jobs ? Math.round(v.total_try / v.jobs) : 0;
  const days = Math.max(1, Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1);
  const max = Math.max(1, ...v.series.map((x) => x.try), ...v.prev_series.map((x) => x.try));
  const W = 720, H = 180, n = Math.max(1, v.series.length - 1);
  const X = (i: number) => (v.series.length === 1 ? W / 2 : (i / n) * W);
  const Y = (val: number) => H - (val / max) * (H - 16) - 4;
  const line = v.series.map((x, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(x.try).toFixed(1)}`).join(" ");
  const area = `${line} L${X(v.series.length - 1).toFixed(1)},${H} L${X(0).toFixed(1)},${H} Z`;
  const prevMap = new Map(v.prev_series.map((x) => [x.i, x.try]));
  const prevLine = v.series.map((_, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(prevMap.get(i) ?? 0).toFixed(1)}`).join(" ");
  const label = (b: string) => (v.bucket === "day" ? `${b.slice(8, 10)} ${MONTHS[Number(b.slice(5, 7)) - 1]}` : v.bucket === "month" ? `${MONTHS[Number(b.slice(5, 7)) - 1]} ${b.slice(2, 4)}` : b.slice(0, 4));
  const ticks = v.series.map((x, i) => ({ i, b: x.b })).filter((_, i, a) => a.length <= 8 || i % Math.ceil(a.length / 8) === 0 || i === a.length - 1);
  const kindTotal = v.by_kind.reduce((a, k) => a + k.try, 0) || 1;
  const chip = (key: string, text: string) => (
    <Link href={q({ aralik: key, bas: undefined, bit: undefined })} className={`h-9 px-3.5 rounded-full grid place-items-center text-[13px] font-semibold whitespace-nowrap transition ${r.key === key ? "bg-[#0B1F3A] text-white shadow" : "bg-white border border-line text-[#33414F] hover:border-brand-600"}`}>{text}</Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mb-1">
          {chip("bugun", "Bugün")}{chip("dun", "Dün")}{chip("hafta", "Bu hafta")}{chip("ay", "Bu ay")}{chip("gecenay", "Geçen ay")}{chip("son30", "Son 30 gün")}{chip("ceyrek", "Bu çeyrek")}{chip("yil", "Bu yıl")}
        </div>
        <form action={base.split("?")[0]} className="flex flex-wrap items-center gap-2 ml-auto">
          {base.includes("sekme=") && <input type="hidden" name="sekme" value="ciro" />}
          <input type="hidden" name="aralik" value="ozel" />
          {p.esas && <input type="hidden" name="esas" value={p.esas} />}
          {kind && <input type="hidden" name="tur" value={kind} />}
          <input type="date" name="bas" defaultValue={r.from} aria-label="Başlangıç" className="h-9 rounded-lg border border-[#D5DEE8] bg-white px-2 text-sm" />
          <span className="text-muted">–</span>
          <input type="date" name="bit" defaultValue={r.to} aria-label="Bitiş" className="h-9 rounded-lg border border-[#D5DEE8] bg-white px-2 text-sm" />
          <button className="h-9 px-3 rounded-lg bg-brand-700 text-white text-sm font-semibold">Göster</button>
        </form>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted">Ciro esası:</span>
        <Link href={q({ esas: undefined })} className={`px-3 py-1 rounded-full font-semibold ${basis === "in" ? "bg-[#E7F1FB] text-brand-700" : "text-muted"}`}>İş girişi</Link>
        <Link href={q({ esas: "teslim" })} className={`px-3 py-1 rounded-full font-semibold ${basis === "delivered" ? "bg-[#E7F1FB] text-brand-700" : "text-muted"}`}>Teslim</Link>
        <span className="text-muted ml-3">Müşteri türü:</span>
        <Link href={q({ tur: undefined })} className={`px-3 py-1 rounded-full font-semibold ${!kind ? "bg-[#E7F1FB] text-brand-700" : "text-muted"}`}>Hepsi</Link>
        {Object.entries(KIND).map(([k2, [l, col]]) => (
          <Link key={k2} href={q({ tur: k2 })} className={`px-3 py-1 rounded-full font-semibold inline-flex items-center gap-1.5 ${kind === k2 ? "bg-[#E7F1FB] text-brand-700" : "text-muted"}`}><span className="w-2 h-2 rounded-full" style={{ background: col }} />{l}</Link>
        ))}
      </div>

      <section className="relative overflow-hidden rounded-[20px] p-5 md:p-6 text-white bg-[radial-gradient(circle_at_85%_0%,rgba(56,189,248,.35),transparent_45%),radial-gradient(circle_at_0%_100%,rgba(16,185,129,.25),transparent_40%),linear-gradient(135deg,#0B1F3A,#13315C)]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[.2em] text-white/60">Toplam ciro · {r.from === r.to ? dt(r.from) : `${dt(r.from)} – ${dt(r.to)}`}</p>
            <p className="font-display text-4xl md:text-5xl font-bold num mt-1">{TL(v.total_try)}</p>
            <p className="text-sm text-white/70 mt-1">
              {ch === null ? "Önceki dönemde ciro yok" : <><span className={`font-bold ${ch >= 0 ? "text-[#6EE7B7]" : "text-[#FCA5A5]"}`}>{ch >= 0 ? "▲" : "▼"} %{Math.abs(ch).toLocaleString("tr-TR")}</span> önceki {days} güne göre ({TL(v.prev_try)})</>}
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm min-w-[280px]">
            {([["İş", v.jobs.toLocaleString("tr-TR"), pct(v.jobs, v.prev_jobs)], ["Müşteri", v.customers.toLocaleString("tr-TR"), pct(v.customers, v.prev_customers)], ["İş başına", short(avg) + " ₺", null], ["Tahsilat", short(v.collected_try) + " ₺", null]] as const).map(([l, val, c2]) => (
              <div key={l} className="rounded-2xl bg-white/10 backdrop-blur px-3 py-2.5 border border-white/10">
                <span className="block text-[11px] text-white/60">{l}</span>
                <b className="num text-lg">{val}</b>
                {c2 !== null && <span className={`ml-1 text-[11px] font-semibold ${c2 >= 0 ? "text-[#6EE7B7]" : "text-[#FCA5A5]"}`}>{c2 >= 0 ? "+" : ""}{c2}%</span>}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-5">
          <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-full h-44 md:h-52" role="img" aria-label="Ciro grafiği: bu dönem ve önceki dönem">
            <defs>
              <linearGradient id="revfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#38BDF8" stopOpacity=".55" /><stop offset="100%" stopColor="#38BDF8" stopOpacity="0" /></linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={W} y1={H - g * (H - 16)} y2={H - g * (H - 16)} stroke="rgba(255,255,255,.08)" />)}
            <path d={prevLine} fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.5" strokeDasharray="4 4" />
            <path d={area} fill="url(#revfill)" />
            <path d={line} fill="none" stroke="#38BDF8" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {v.series.map((x, i) => x.try > 0 && v.series.length <= 62 ? <circle key={x.b} cx={X(i)} cy={Y(x.try)} r="3" fill="#E0F2FE"><title>{`${label(x.b)} · ${TL(x.try)} · ${x.jobs} iş`}</title></circle> : null)}
            {ticks.map((t) => <text key={t.b} x={X(t.i)} y={H + 16} fill="rgba(255,255,255,.55)" fontSize="11" textAnchor="middle">{label(t.b)}</text>)}
          </svg>
          <p className="text-[11px] text-white/50 flex gap-4"><span><span className="inline-block w-3 h-0.5 bg-[#38BDF8] align-middle" /> bu dönem</span><span><span className="inline-block w-3 border-t border-dashed border-white/50 align-middle" /> önceki dönem</span><span>{v.bucket === "day" ? "günlük" : v.bucket === "month" ? "aylık" : "yıllık"} · {v.units.toLocaleString("tr-TR")} birim</span></p>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="bg-white border border-line rounded-[16px] p-4 flex flex-col gap-3">
          <h2 className="font-display font-semibold text-brand-800">Müşteri türüne göre</h2>
          <div className="flex h-3 rounded-full overflow-hidden bg-[#EEF2F6]">
            {v.by_kind.map((k) => <span key={k.kind} title={`${KIND[k.kind]?.[0] ?? k.kind}: ${TL(k.try)}`} style={{ width: `${(k.try / kindTotal) * 100}%`, background: KIND[k.kind]?.[1] ?? "#94A3B8" }} />)}
          </div>
          <ul className="flex flex-col gap-2 text-sm">
            {v.by_kind.map((k) => (
              <li key={k.kind} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: KIND[k.kind]?.[1] ?? "#94A3B8" }} />
                <Link href={q({ tur: k.kind })} className="flex-1 hover:underline">{KIND[k.kind]?.[0] ?? k.kind} <span className="text-xs text-muted">· {k.customers} müşteri · {k.jobs} iş</span></Link>
                <b className="num">{TL(k.try)}</b>
                <span className="text-xs text-muted w-10 text-right">%{Math.round((k.try / kindTotal) * 100)}</span>
              </li>
            ))}
            {!v.by_kind.length && <li className="text-muted">Bu aralıkta iş yok.</li>}
          </ul>
        </section>
        <section className="bg-white border border-line rounded-[16px] p-4 flex flex-col gap-3">
          <h2 className="font-display font-semibold text-brand-800">En çok satan ürünler</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {v.by_product.slice(0, 8).map((pr, i) => {
              const w = (pr.try / Math.max(1, v.by_product[0]?.try ?? 1)) * 100;
              return (
                <li key={pr.name + i} className="relative rounded-lg px-2 py-1.5 overflow-hidden">
                  <span className="absolute inset-y-0 left-0 bg-[#E7F1FB]" style={{ width: `${w}%` }} />
                  <span className="relative flex gap-2"><span className="flex-1 truncate">{pr.name}</span><span className="text-xs text-muted">{pr.qty} adet</span><b className="num">{short(pr.try)} ₺</b></span>
                </li>
              );
            })}
            {!v.by_product.length && <li className="text-muted">Ürün satırı yok.</li>}
          </ul>
        </section>
        <section className="bg-white border border-line rounded-[16px] p-4 flex flex-col gap-3">
          <h2 className="font-display font-semibold text-brand-800">Dikkat</h2>
          <div>
            <p className="text-xs font-bold text-ok mb-1">🆕 Yeni müşteriler ({v.by_customer.filter((c) => c.new).length})</p>
            <ul className="text-sm flex flex-col gap-0.5">{v.by_customer.filter((c) => c.new).slice(0, 5).map((c) => <li key={c.id} className="flex gap-2"><span className="flex-1 truncate">{c.name}</span><b className="num">{short(c.try)} ₺</b></li>)}</ul>
          </div>
          <div>
            <p className="text-xs font-bold text-bad mb-1">⚠️ Önceki dönem çalışıp bu dönem iş göndermeyenler ({v.lost.length})</p>
            <ul className="text-sm flex flex-col gap-0.5">{v.lost.slice(0, 6).map((c) => <li key={c.id} className="flex gap-2"><Link href={`/isler/hekimler/${c.id}`} className="flex-1 truncate hover:underline">{c.name}</Link><span className="num text-muted">{short(c.prev_try)} ₺</span></li>)}{!v.lost.length && <li className="text-muted">Kaybedilen müşteri yok 👍</li>}</ul>
          </div>
        </section>
      </div>

      <RevenueTable rows={v.by_customer} total={v.total_try} bucket={v.bucket} from={r.from} to={r.to} />
    </div>
  );
}
