import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { cancelSlip, openSlipParty } from "@/lib/supplier-actions";
import { TXN_KIND } from "@/lib/fin";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { SlipForm } from "./SlipForm";

export const dynamic = "force-dynamic";

type P = { id: string; name: string; currency: string; opening_balance: number; slip_of: string | null };
type Mv = { amount: number; move_date: string; party_id: string; fin_txns: { id: string; kind: string; doc_no: string | null; description: string | null; ref_type: string | null; ref_id: string | null; voided_at: string | null; created_at: string } };
const f2 = (k: number) => (Math.abs(k) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const B = ({ v }: { v: number }) => <span className={v < 0 ? "text-bad" : v > 0 ? "text-ok" : "text-muted"}>{f2(v)}{v < 0 ? " B" : v > 0 ? " A" : ""}</span>;

/** Firma: faturalı cari ve fişli cari yan yana; fiş ekle, mal kabul tutarı gir, ortak ödeme hareketleri */
export default async function SlipPairPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 1 && (s.modules.purchases ?? 0) < 1) redirect("/");
  const canEdit = (s.modules.finance ?? 0) >= 2 || (s.modules.purchases ?? 0) >= 2;
  const supabase = await createClient();
  const { data: p0, error } = await supabase.from("fin_parties").select("id, name, currency, opening_balance, slip_of").eq("id", id).maybeSingle();
  if (error) return (<><PageHeader title="Fişli / faturalı cari" /><div className={page}><Notice tone="bad">Supabase&apos;de 20270129000000_slip_party.sql çalıştırılmalı.</Notice></div></>);
  if (!p0) notFound();
  if ((p0 as P).slip_of) redirect(`/finans/fis-cari/${(p0 as P).slip_of}`);
  const main = p0 as P;
  const { data: t0 } = await supabase.from("fin_parties").select("id, name, currency, opening_balance, slip_of").eq("slip_of", main.id).maybeSingle();
  const twin = t0 as P | null;
  if (!twin) {
    return (
      <>
        <PageHeader title={main.name} subtitle="Bu firmanın fişli carisi yok" actions={<Link href="/finans/fis-cari" className="text-sm font-semibold text-brand-700">← Fişli / faturalı cariler</Link>} />
        <div className={page}>
          <p className="text-sm text-muted">Bu firmadan fişle (faturasız) mal alıyorsanız bir fişli cari açın. Ödemeler iki cariye de aynı tutarla düşer.</p>
          {canEdit && <form action={openSlipParty}><input type="hidden" name="cari" value={main.id} /><PendingSubmit className="h-11 rounded-[10px] bg-brand-700 px-4 font-semibold text-white">Fişli cari aç</PendingSubmit></form>}
        </div>
      </>
    );
  }
  const [{ data: mv }, { data: rc }, { data: slips }] = await Promise.all([
    supabase.from("fin_moves").select("amount, move_date, party_id, fin_txns!inner(id, kind, doc_no, description, ref_type, ref_id, voided_at, created_at)").in("party_id", [main.id, twin.id]).order("move_date").limit(3000),
    supabase.from("stk_receipts").select("id, year, no, supplier_doc, confirmed_at").eq("party_id", twin.id).eq("status", "confirmed").order("confirmed_at", { ascending: false }).limit(50),
    supabase.from("sup_slips").select("id, receipt_id, photo, fin_txn_id").eq("party_id", twin.id).eq("cancelled", false),
  ]);
  const cur = main.currency;
  const slipByTxn = new Map(((slips ?? []) as { id: string; fin_txn_id: string | null; photo: string | null }[]).filter((x) => x.fin_txn_id).map((x) => [x.fin_txn_id!, x]));
  const used = new Set(((slips ?? []) as { receipt_id: string | null }[]).map((x) => x.receipt_id).filter(Boolean));
  const waiting = ((rc ?? []) as { id: string; year: number; no: number; supplier_doc: string | null; confirmed_at: string }[]).filter((r) => !used.has(r.id));

  // Aynı ödemenin iki carideki satırı tek satırda: yansıma (mirror) asıl işlemle birleşir
  type Row = { key: string; date: string; created: string; kind: string; doc: string | null; desc: string | null; inv: number | null; slip: number | null; slipId?: string; photo?: string | null };
  const rows = new Map<string, Row>();
  for (const x of ((mv ?? []) as unknown as Mv[]).filter((x) => !x.fin_txns.voided_at)) {
    const t = x.fin_txns;
    const key = t.ref_type === "mirror" && t.ref_id ? t.ref_id : t.id;
    const r = rows.get(key) ?? { key, date: x.move_date, created: t.created_at, kind: t.kind, doc: t.doc_no, desc: t.ref_type === "mirror" ? null : t.description, inv: null, slip: null };
    if (t.ref_type !== "mirror") { r.desc = t.description; r.doc = t.doc_no ?? r.doc; }
    if (x.party_id === main.id) r.inv = (r.inv ?? 0) + Number(x.amount);
    else r.slip = (r.slip ?? 0) + Number(x.amount);
    const sl = slipByTxn.get(t.id);
    if (sl) { r.slipId = sl.id; r.photo = sl.photo; }
    rows.set(key, r);
  }
  let bi = Number(main.opening_balance), bs = Number(twin.opening_balance);
  const lines = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || a.created.localeCompare(b.created)).map((r) => { bi += r.inv ?? 0; bs += r.slip ?? 0; return { ...r, bi, bs }; });

  return (
    <>
      <PageHeader title={main.name} subtitle={`Faturalı ve fişli cari · ${cur} · B: borcumuz, A: alacağımız`}
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href={`/finans/islem?tur=payment&cari=${main.id}&geri=/finans/fis-cari/${main.id}`} className="text-brand-700">+ Ödeme</Link><Link href="/finans/cek-senet" className="text-brand-700">+ Çek / senet</Link><Link href="/finans/fis-cari" className="text-brand-700">← Liste</Link></span>} />
      <div className={`${page} max-w-[1200px]`}>
        <div className="grid gap-3 md:grid-cols-2">
          <Link href={`/finans/cariler/${main.id}`} className="rounded-[16px] border border-line bg-white p-4 hover:border-brand-600">
            <span className="text-xs text-muted">🧾 Faturalı cari · {main.name}</span><b className="block text-3xl num mt-1"><B v={bi} /></b><span className="text-xs text-brand-700 font-semibold">Cari kart / ekstre →</span>
          </Link>
          <Link href={`/finans/cariler/${twin.id}`} className="rounded-[16px] border border-[#FCD34D] bg-[#FFFBEB] p-4 hover:border-[#F59E0B]">
            <span className="text-xs text-muted">📄 Fişli cari · {twin.name}</span><b className="block text-3xl num mt-1"><B v={bs} /></b><span className="text-xs text-brand-700 font-semibold">Cari kart / ekstre →</span>
          </Link>
        </div>
        <Notice tone="info">Ödeme, çek ve senet iki cariye de aynı tutarla düşer; bu yüzden iki bakiye ayrı ayrı okunur. Faturalı alım için Alış faturası girin; fişli alım için mal kabulde “Fişli” seçin ya da aşağıdan fiş ekleyin.</Notice>

        {!!waiting.length && canEdit && (
          <section className="rounded-[16px] border border-[#FCD34D] bg-white p-4 md:p-5">
            <h2 className="mb-1 font-display text-lg font-bold">Tutarı girilmemiş fişli mal kabuller ({waiting.length})</h2>
            <p className="mb-3 text-xs text-muted">Ürünlerde fiyat olmadığı için tutar hesaplanamadı; fişteki tutarı yazın.</p>
            <ul className="flex flex-col gap-3">
              {waiting.map((r) => (
                <li key={r.id} className="rounded-[12px] border border-line p-3">
                  <Link href={`/stok/mal-kabul/${r.id}`} className="text-sm font-semibold text-brand-700">MK-{r.year}-{String(r.no).padStart(4, "0")}</Link> <span className="text-xs text-muted">{r.supplier_doc ?? ""} · {formatDate(r.confirmed_at.slice(0, 10))}</span>
                  <div className="mt-2"><SlipForm compact party={twin.id} currency={cur} receipt={r.id} defDoc={r.supplier_doc ?? ""} /></div>
                </li>
              ))}
            </ul>
          </section>
        )}
        {canEdit && <details className="rounded-[16px] border border-line bg-white p-4 md:p-5"><summary className="cursor-pointer font-display text-lg font-bold">+ Fiş ekle (mal kabulsüz)</summary><div className="mt-3"><SlipForm party={twin.id} currency={cur} /></div></details>}

        <section className="overflow-x-auto rounded-[16px] border border-line bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted bg-[#F7F9FB]"><th className="p-3">Tarih</th><th className="p-3">Hareket</th><th className="p-3">Belge / açıklama</th><th className="p-3 text-right">🧾 Faturalı</th><th className="p-3 text-right">Bakiye</th><th className="p-3 text-right">📄 Fişli</th><th className="p-3 text-right">Bakiye</th><th className="p-3" /></tr></thead>
            <tbody>
              {(Number(main.opening_balance) || Number(twin.opening_balance)) ? <tr className="border-b border-[#EEF2F6] bg-[#F7F9FC]"><td className="p-3" colSpan={3}>Açılış bakiyesi</td><td /><td className="p-3 text-right num"><B v={Number(main.opening_balance)} /></td><td /><td className="p-3 text-right num"><B v={Number(twin.opening_balance)} /></td><td /></tr> : null}
              {lines.map((r) => (
                <tr key={r.key} className={`border-b border-[#EEF2F6] ${r.kind === "purchase_slip" ? "bg-[#FFFBEB]" : r.kind === "purchase_invoice" ? "bg-[#F5F3FF]" : ""}`}>
                  <td className="p-3 whitespace-nowrap">{formatDate(r.date)}</td>
                  <td className="p-3 font-semibold">{TXN_KIND[r.kind] ?? r.kind}{r.inv !== null && r.slip !== null && <span className="block text-[11px] font-normal text-muted">iki cariye</span>}</td>
                  <td className="p-3">{[r.doc, r.desc].filter(Boolean).join(" · ")}{r.photo && <a href={r.photo} target="_blank" rel="noopener" className="ml-2 text-xs font-semibold text-brand-700">foto</a>}</td>
                  <td className="p-3 text-right num">{r.inv === null ? <span className="text-[#C5D0DB]">—</span> : <B v={r.inv} />}</td>
                  <td className="p-3 text-right num text-xs">{r.inv === null ? "" : <B v={r.bi} />}</td>
                  <td className="p-3 text-right num">{r.slip === null ? <span className="text-[#C5D0DB]">—</span> : <B v={r.slip} />}</td>
                  <td className="p-3 text-right num text-xs">{r.slip === null ? "" : <B v={r.bs} />}</td>
                  <td className="p-3 text-right">{r.slipId && canEdit && <form action={cancelSlip}><input type="hidden" name="id" value={r.slipId} /><button className="text-xs font-semibold text-bad">İptal</button></form>}</td>
                </tr>
              ))}
              {!lines.length && <tr><td colSpan={8} className="p-6 text-center text-muted">Hareket yok.</td></tr>}
            </tbody>
          </table>
        </section>
        <p className="text-xs text-muted">Açılış bakiyeleri cari kartlardan girilir (Cari kart › Düzenle › Eski bakiye).</p>
      </div>
    </>
  );
}
