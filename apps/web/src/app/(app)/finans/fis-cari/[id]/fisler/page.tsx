import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fişler ve kalemler" };

type Line = { name: string; qty: number; unit: string | null; price: number; amount: number; sort: number };
type Slip = { id: string; party_id: string; slip_date: string; doc_no: string | null; amount: number; note: string | null; cancelled: boolean; sup_slip_lines: Line[] };
const f2 = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SYM: Record<string, string> = { TRY: "₺", EUR: "€", USD: "$" };
const day = (d: string) => d.split("-").reverse().join(".");
const fold = (t: string) => t.toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c").normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Firmanın fişli carilerindeki fişler, kalemleriyle: gün / tarih aralığı / ürün araması */
export default async function SlipLinesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bas?: string; bit?: string; q?: string; cari?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 1 && (s.modules.purchases ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const iso = (v?: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? "") ? v! : null);
  const to = iso(sp.bit) ?? today;
  const from = iso(sp.bas) ?? new Date(new Date(to).getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const supabase = await createClient();
  const { data: main } = await supabase.from("fin_parties").select("id, name, slip_of").eq("id", id).maybeSingle();
  if (!main) notFound();
  if (main.slip_of) redirect(`/finans/fis-cari/${main.slip_of}/fisler`);
  const { data: side } = await supabase.from("fin_parties").select("id, name, currency, sub_kind").eq("slip_of", id).order("sub_kind", { nullsFirst: true });
  const parties = ((side ?? []) as { id: string; name: string; currency: string; sub_kind: string | null }[]).filter((p) => p.sub_kind !== "vat");
  const sel = parties.filter((p) => !sp.cari || p.id === sp.cari);
  const { data, error } = sel.length
    ? await supabase.from("sup_slips").select("id, party_id, slip_date, doc_no, amount, note, cancelled, sup_slip_lines(name, qty, unit, price, amount, sort)")
        .in("party_id", sel.map((p) => p.id)).eq("cancelled", false).gte("slip_date", from).lte("slip_date", to).order("slip_date", { ascending: false }).limit(1000)
    : { data: [], error: null };
  const pName = new Map(parties.map((p) => [p.id, p]));
  const q = fold(sp.q ?? "").trim();
  let slips = ((data ?? []) as Slip[]).map((x) => ({ ...x, sup_slip_lines: [...(x.sup_slip_lines ?? [])].sort((a, b) => a.sort - b.sort) }));
  if (q) slips = slips.map((x) => ({ ...x, sup_slip_lines: x.sup_slip_lines.filter((l) => fold(l.name).includes(q)) })).filter((x) => x.sup_slip_lines.length);
  const tot = new Map<string, number>();
  for (const x of slips) { const c = pName.get(x.party_id)?.currency ?? "TRY"; tot.set(c, (tot.get(c) ?? 0) + (q ? x.sup_slip_lines.reduce((a, l) => a + Number(l.amount), 0) : Number(x.amount))); }
  // ürün özeti (aralıktaki toplam miktar)
  const sum = new Map<string, { qty: number; unit: string | null; amount: number; cur: string }>();
  for (const x of slips) for (const l of x.sup_slip_lines) { const k = l.name; const g = sum.get(k) ?? { qty: 0, unit: l.unit, amount: 0, cur: pName.get(x.party_id)?.currency ?? "TRY" }; g.qty += Number(l.qty); g.amount += Number(l.amount); sum.set(k, g); }
  const qs = (p: Record<string, string>) => `?${new URLSearchParams({ bas: from, bit: to, ...(sp.q ? { q: sp.q } : {}), ...(sp.cari ? { cari: sp.cari } : {}), ...p })}`;
  const inp = "h-10 rounded-[10px] border border-[#D5DEE8] px-3 bg-white text-sm";

  return (
    <>
      <PageHeader title={`${main.name} · fişler ve kalemler`} subtitle="Fişle (faturasız) alınan malzemeler, ürün ürün" actions={<Link href={`/finans/fis-cari/${id}`} className="text-sm font-semibold text-brand-700">← Firma ekstresi</Link>} />
      <div className={`${page} max-w-[1200px]`}>
        {error && <Notice tone="bad">{/sup_slip_lines|schema cache/.test(error.message) ? "Supabase'de 20270267000000_supplier_cari_group.sql çalıştırılmalı." : error.message}</Notice>}
        <form method="get" className="flex flex-wrap items-end gap-2 rounded-[16px] border border-line bg-white p-3">
          <label className="flex flex-col gap-1 text-xs text-muted">Başlangıç<input type="date" name="bas" defaultValue={from} className={inp} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Bitiş<input type="date" name="bit" defaultValue={to} className={inp} /></label>
          {parties.length > 1 && <label className="flex flex-col gap-1 text-xs text-muted">Cari<select name="cari" defaultValue={sp.cari ?? ""} className={inp}><option value="">Hepsi</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
          <label className="flex flex-col gap-1 text-xs text-muted flex-1 min-w-[200px]">Ürün ara<input name="q" defaultValue={sp.q ?? ""} placeholder="ör. alçı, signum, metal" className={inp} /></label>
          <button className="h-10 px-5 rounded-[10px] bg-brand-700 text-white font-semibold text-sm">Göster</button>
          <span className="flex gap-3 text-sm font-semibold ml-2">
            <Link href={qs({ bas: today, bit: today })} className="text-brand-700">Bugün</Link>
            <Link href={qs({ bas: new Date(Date.now() - 6 * 86400000 + 3 * 3600000).toISOString().slice(0, 10), bit: today })} className="text-brand-700">Son 7 gün</Link>
            <Link href={qs({ bas: `${today.slice(0, 7)}-01`, bit: today })} className="text-brand-700">Bu ay</Link>
            <Link href={qs({ bas: "2026-01-01", bit: today })} className="text-brand-700">2026</Link>
          </span>
        </form>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[16px] border border-line bg-white p-4"><span className="text-xs text-muted">Fiş · {day(from)} – {day(to)}</span><b className="block text-2xl num mt-1">{slips.length}</b></div>
          <div className="rounded-[16px] border border-line bg-white p-4"><span className="text-xs text-muted">Kalem</span><b className="block text-2xl num mt-1">{slips.reduce((a, x) => a + x.sup_slip_lines.length, 0)}</b></div>
          <div className="rounded-[16px] border border-line bg-white p-4"><span className="text-xs text-muted">Bu aralıkta alınan malzeme (liste fiyatıyla) · borç değildir</span><b className="block text-2xl num mt-1">{[...tot.entries()].map(([c, v]) => `${f2(v)} ${SYM[c] ?? c}`).join(" · ") || "0"}</b></div>
        </section>

        <section className="flex flex-col gap-3">
          {slips.map((x) => {
            const p = pName.get(x.party_id); const cur = SYM[p?.currency ?? "TRY"] ?? p?.currency;
            return (
              <div key={x.id} className="rounded-[16px] border border-line bg-white overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-[#FFFBEB] border-b border-line text-sm">
                  <b>{day(x.slip_date)}</b>
                  {x.doc_no && !x.doc_no.startsWith("#") && <span className="text-muted">Fiş {x.doc_no}</span>}
                  <span className={`text-xs font-semibold rounded px-1.5 py-0.5 ${p?.sub_kind === "nodisc" ? "bg-white border border-[#FCD34D]" : "bg-[#FDE68A]"}`}>{p?.sub_kind === "nodisc" ? "iskontosuz" : "iskontolu"}</span>
                  {x.note && <span className="text-xs text-muted">{x.note}</span>}
                  <b className="ml-auto num">{f2(Number(x.amount))} {cur}</b>
                </div>
                {x.sup_slip_lines.length ? (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted"><th className="px-4 py-1.5">Ürün</th><th className="px-4 py-1.5 text-right">Miktar</th><th className="px-4 py-1.5 text-right">Liste fiyatı</th><th className="px-4 py-1.5 text-right">Tutar</th></tr></thead>
                    <tbody>{x.sup_slip_lines.map((l, i) => (
                      <tr key={i} className="border-t border-[#F1F4F8]"><td className="px-4 py-1.5">{l.name}</td><td className="px-4 py-1.5 text-right num">{Number(l.qty).toLocaleString("tr-TR")} {l.unit ?? ""}</td><td className="px-4 py-1.5 text-right num">{f2(Number(l.price))}</td><td className="px-4 py-1.5 text-right num font-semibold">{f2(Number(l.amount))} {cur}</td></tr>
                    ))}</tbody>
                  </table>
                ) : <p className="px-4 py-2 text-xs text-muted">Kalem yok (toplam tutarla girilmiş fiş).</p>}
              </div>
            );
          })}
          {!slips.length && <p className="rounded-[16px] border border-line bg-white p-6 text-center text-muted">Bu aralıkta fiş yok.</p>}
        </section>

        {sum.size > 0 && (
          <details className="rounded-[16px] border border-line bg-white p-4">
            <summary className="cursor-pointer font-display text-lg font-bold">Ürün özeti ({sum.size} ürün)</summary>
            <table className="w-full text-sm mt-3"><tbody>
              {[...sum.entries()].sort((a, b) => b[1].amount - a[1].amount).map(([n, g]) => <tr key={n} className="border-t border-[#F1F4F8]"><td className="py-1.5">{n}</td><td className="py-1.5 text-right num">{g.qty.toLocaleString("tr-TR")} {g.unit ?? ""}</td><td className="py-1.5 text-right num font-semibold">{f2(g.amount)} {SYM[g.cur] ?? g.cur}</td></tr>)}
            </tbody></table>
          </details>
        )}
        <p className="text-xs text-muted">Faturalı (resmi) caride faturaların kalemleri tedarikçinin ekstresinde yoktur; fatura içerikleri e-fatura olarak Satın alma › Gelen e-belgeler&apos;den gelir.</p>
      </div>
    </>
  );
}
