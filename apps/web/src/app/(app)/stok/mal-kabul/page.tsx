import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { RCV_STATUS, rcvNo } from "@/lib/barcode";
import { rcvMatch } from "@/lib/barcode-actions";
import { StartForm } from "./StartForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mal kabul" };

type Rcv = { id: string; year: number; no: number; status: string; supplier_doc: string | null; add_to_stock: boolean | null; invoice_id: string | null; party_id: string | null; created_at: string; confirmed_at: string | null; fin_parties: { name: string } | null; stk_receipt_lines: { qty: number; expected: number; damaged: number }[] };
type Inv = { id: string; doc_no: string | null; no: number; invoice_date: string; party_id: string; total: number; currency: string };

/** Mal kabul: siparişten ya da fişle gelen malı okutarak teyit et; faturalılar e-faturayla eşleşir */
export default async function ReceivingPage() {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 1 && (s.modules.purchases ?? 0) < 1) redirect("/");
  const supabase = await createClient();
  const [{ data: rc, error }, { data: po }, { data: pt }, { data: wh }] = await Promise.all([
    supabase.from("stk_receipts").select("id, year, no, status, supplier_doc, add_to_stock, invoice_id, party_id, created_at, confirmed_at, fin_parties(name), stk_receipt_lines(qty, expected, damaged)").neq("status", "cancelled").order("created_at", { ascending: false }).limit(150),
    supabase.from("pur_orders").select("id, year, no, status, order_date, fin_parties(name)").in("status", ["approved", "sent", "partial"]).order("order_date", { ascending: false }).limit(200),
    supabase.from("fin_parties").select("id, name").order("name").limit(1500),
    supabase.from("stk_warehouses").select("id, name, is_default").eq("is_active", true).order("name"),
  ]);
  const rows = (rc ?? []) as unknown as Rcv[];
  const open = rows.filter((r) => r.status === "open");
  const waiting = rows.filter((r) => r.status === "confirmed" && r.add_to_stock === false && !r.invoice_id);
  const done = rows.filter((r) => r.status === "confirmed" && !waiting.includes(r)).slice(0, 40);
  const parties = [...new Set(waiting.map((r) => r.party_id).filter(Boolean))] as string[];
  const { data: invs } = parties.length
    ? await supabase.from("inv_invoices").select("id, doc_no, no, invoice_date, party_id, total, currency").eq("direction", "purchase").neq("status", "cancelled").in("party_id", parties).gte("invoice_date", new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10)).order("invoice_date", { ascending: false }).limit(300)
    : { data: [] };
  const used = new Set(rows.map((r) => r.invoice_id).filter(Boolean));
  const I = ((invs ?? []) as Inv[]).filter((i) => !used.has(i.id));
  const sum = (r: Rcv) => r.stk_receipt_lines.reduce((n, l) => n + Number(l.qty), 0);
  const diff = (r: Rcv) => r.stk_receipt_lines.some((l) => (Number(l.expected) > 0 && Number(l.qty) !== Number(l.expected)) || Number(l.damaged) > 0);
  const Row = ({ r, children }: { r: Rcv; children?: React.ReactNode }) => {
    const [label, cls] = RCV_STATUS[r.status] ?? RCV_STATUS.open!;
    return (
      <li className="bg-white border border-line rounded-[14px] p-4 flex flex-wrap items-center gap-3">
        <Link href={`/stok/mal-kabul/${r.id}`} className="flex flex-1 min-w-[240px] flex-wrap items-center gap-3 hover:underline">
          <b className="num w-28">{rcvNo(r)}</b>
          <span className="flex-1"><b>{r.fin_parties?.name ?? "Tedarikçi yok"}</b>{r.supplier_doc ? <span className="text-muted"> · {r.supplier_doc}</span> : null}<span className="block text-xs text-muted">{r.stk_receipt_lines.length} kalem · {sum(r).toLocaleString("tr-TR")} adet{diff(r) ? " · ⚠ eksik / fazla / hasarlı" : ""}</span></span>
        </Link>
        {r.status === "confirmed" && <span className={`text-xs font-semibold ${r.add_to_stock ? "text-ok" : "text-[#6D28D9]"}`}>{r.add_to_stock ? "stoğa girdi (faturasız)" : r.invoice_id ? "✓ faturayla eşleşti" : "fatura bekleniyor"}</span>}
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${cls}`}>{label}</span>
        <span className="text-xs text-muted w-20 text-right">{formatDate((r.confirmed_at ?? r.created_at).slice(0, 10))}</span>
        {children}
      </li>
    );
  };

  return (
    <>
      <PageHeader title="Mal kabul" subtitle="Gelen malı okutarak teyit edin · faturalı mal e-faturayla stoğa girer, faturasız mal hemen girer" />
      <div className={`${page} max-w-[1100px]`}>
        {error && <Notice tone="bad">Supabase&apos;de 20270107000000_barcode.sql çalıştırılmalı.</Notice>}
        {(s.modules.stock ?? 0) >= 2 && (
          <section className="bg-white border border-line rounded-[16px] p-4 md:p-5">
            <h2 className="font-display text-lg font-bold mb-3">Yeni mal kabul</h2>
            <StartForm
              orders={((po ?? []) as unknown as { id: string; year: number; no: number; order_date: string; fin_parties: { name: string } | null }[]).map((o) => ({ id: o.id, label: `SA-${o.year}-${String(o.no).padStart(4, "0")} · ${o.fin_parties?.name ?? ""} · ${formatDate(o.order_date)}` }))}
              parties={(pt ?? []) as { id: string; name: string }[]} warehouses={(wh ?? []) as { id: string; name: string; is_default: boolean }[]} />
          </section>
        )}
        {!!open.length && <section className="flex flex-col gap-2"><h2 className="font-display text-lg font-bold">Okutulmakta</h2><ul className="flex flex-col gap-2">{open.map((r) => <Row key={r.id} r={r} />)}</ul></section>}
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-bold">Faturası beklenen mal kabuller <span className="text-sm font-normal text-muted">· {waiting.length}</span></h2>
          <p className="text-xs text-muted">E-fatura içe aktarıldığında buradan ilgili mal kabulle eşleştirin; okutulan ve faturadaki miktarlar mal kabul ekranında karşılaştırılır.</p>
          <ul className="flex flex-col gap-2">
            {waiting.map((r) => {
              const cands = I.filter((i) => i.party_id === r.party_id);
              return (
                <Row key={r.id} r={r}>
                  {cands.length ? (
                    <form action={rcvMatch} className="flex w-full items-center gap-2 md:w-auto">
                      <input type="hidden" name="id" value={r.id} />
                      <select name="invoice" className="h-10 rounded-[10px] border border-[#D5DEE8] px-2 text-sm">{cands.map((i) => <option key={i.id} value={i.id}>{i.doc_no ?? `#${i.no}`} · {formatDate(i.invoice_date)} · {(i.total / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {i.currency}</option>)}</select>
                      <button className="h-10 px-3 rounded-[10px] bg-brand-700 text-sm font-semibold text-white">Eşleştir</button>
                    </form>
                  ) : <span className="text-xs text-muted">Bu tedarikçiden eşleşmemiş fatura yok</span>}
                </Row>
              );
            })}
            {!waiting.length && <li className="rounded-[14px] border border-dashed border-[#C5D0DB] p-5 text-center text-sm text-muted">Faturası beklenen mal kabul yok.</li>}
          </ul>
        </section>
        <section className="flex flex-col gap-2"><h2 className="font-display text-lg font-bold">Son mal kabuller</h2><ul className="flex flex-col gap-2">{done.map((r) => <Row key={r.id} r={r} />)}</ul></section>
      </div>
    </>
  );
}
