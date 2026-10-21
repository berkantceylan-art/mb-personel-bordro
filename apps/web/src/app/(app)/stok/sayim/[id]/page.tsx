import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, EmptyRow, KPI, Money, Table, btnPrimary, btnSecondary, inputCls, page, td, tdNum } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { closeCount, saveCountLines } from "@/lib/stock-actions";
import { COUNT_STATUS, qty } from "@/lib/stock";
import { CountScanner } from "./CountScanner";

export const dynamic = "force-dynamic";

/** Sayım fişi: okutma, elle giriş, fark ve değer, kapatma */
export default async function CountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ f?: string }> }) {
  const s = await getSession();
  const level = s.modules.stock ?? 0;
  if (level < 1) redirect("/");
  const { id } = await params;
  const { f } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("stk_counts").select("*, stk_warehouses(name), stk_categories(name)").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as { id: string; no: number; count_date: string; status: string; blind: boolean; note: string | null; closed_at: string | null; stk_warehouses: { name: string } | null; stk_categories: { name: string } | null };
  const [{ data: lines }, { data: tot }] = await Promise.all([
    supabase.from("stk_count_lines").select("id, item_id, lot_no, expiry_date, expected, counted, counted_at, stk_items(code, name, unit, shelf)").eq("count_id", id).limit(5000),
    supabase.from("stk_item_totals").select("item_id, avg_cost").limit(5000),
  ]);
  type L = { id: string; item_id: string; lot_no: string | null; expiry_date: string | null; expected: number; counted: number | null; counted_at: string | null; stk_items: { code: string; name: string; unit: string; shelf: string | null } | null };
  const cost = new Map((tot ?? []).map((t) => [t.item_id as string, Number(t.avg_cost ?? 0)]));
  const all = ((lines ?? []) as unknown as L[]).map((l) => ({ ...l, expected: Number(l.expected), counted: l.counted === null ? null : Number(l.counted) }))
    .sort((a, b) => (a.stk_items?.shelf ?? "~").localeCompare(b.stk_items?.shelf ?? "~", "tr") || (a.stk_items?.name ?? "").localeCompare(b.stk_items?.name ?? "", "tr"));
  const open = c.status === "open";
  const hideExpected = open && c.blind && level < 3;
  const diffOf = (l: (typeof all)[number]) => (l.counted === null ? null : Math.round((l.counted - l.expected) * 1000) / 1000);
  const shown = all.filter((l) => f === "sayilmadi" ? l.counted === null : f === "fark" ? (diffOf(l) ?? 0) !== 0 : true);
  const countedN = all.filter((l) => l.counted !== null).length;
  const plus = all.reduce((t, l) => { const d = diffOf(l) ?? 0; return d > 0 ? t + Math.round(d * (cost.get(l.item_id) ?? 0)) : t; }, 0);
  const minus = all.reduce((t, l) => { const d = diffOf(l) ?? 0; return d < 0 ? t + Math.round(d * (cost.get(l.item_id) ?? 0)) : t; }, 0);
  const base = `/stok/sayim/${c.id}`;

  return (
    <>
      <PageHeader title={`Sayım #${c.no} · ${c.stk_warehouses?.name ?? ""}`} subtitle={`${formatDate(c.count_date)}${c.stk_categories ? ` · ${c.stk_categories.name}` : ""}${c.note ? ` · ${c.note}` : ""}`} actions={<Link href="/stok/sayim" className="text-sm font-semibold text-brand-700">← Sayımlar</Link>} />
      <div className={page}>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={COUNT_STATUS[c.status]?.[1]}>{COUNT_STATUS[c.status]?.[0]}</Chip>
          {c.blind && <Chip>Kör sayım</Chip>}
          {c.closed_at && <span className="text-sm text-muted">Kapanış: {formatDate(c.closed_at)}</span>}
        </div>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <KPI label="Sayılan kalem" value={`${countedN} / ${all.length}`} />
          <KPI label="Sayılmayan" value={all.length - countedN} href={`${base}?f=sayilmadi`} />
          {!hideExpected && <KPI label="Fazla (değer)" value={<Money v={plus} />} tone="ok" href={`${base}?f=fark`} />}
          {!hideExpected && <KPI label="Eksik (değer)" value={<Money v={minus} />} tone={minus < 0 ? "bad" : undefined} href={`${base}?f=fark`} />}
        </div>

        {open && level >= 2 && <CountScanner countId={c.id} />}

        <nav className="flex gap-1.5 text-sm">
          {[["", "Tümü"], ["sayilmadi", "Sayılmayanlar"], ...(hideExpected ? [] : [["fark", "Farklılar"]])].map(([k, label]) => (
            <Link key={k} href={k ? `${base}?f=${k}` : base} aria-current={(f ?? "") === k ? "page" : undefined} className="rounded-full px-3.5 py-1.5 font-semibold border border-line bg-white aria-[current=page]:bg-brand-700 aria-[current=page]:text-white">{label}</Link>
          ))}
        </nav>

        <form action={saveCountLines} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={c.id} />
          <Table head={["Raf", "Kod", "Malzeme", "Lot / SKT", ...(hideExpected ? [] : ["Sistem"]), "Sayılan", ...(hideExpected ? [] : ["Fark", "Fark değeri"])]} min={880}>
            {shown.map((l) => {
              const d = diffOf(l);
              return (
                <tr key={l.id} className={l.counted === null ? "" : "bg-[#F7FBF8]"}>
                  <td className={`${td} text-muted`}>{l.stk_items?.shelf ?? ""}</td>
                  <td className={`${td} num text-muted`}>{l.stk_items?.code}</td>
                  <td className={td}>{l.stk_items?.name}</td>
                  <td className={`${td} num text-xs`}>{l.lot_no ?? ""}{l.expiry_date ? ` · ${formatDate(l.expiry_date)}` : ""}</td>
                  {!hideExpected && <td className={tdNum}>{qty(l.expected)} {l.stk_items?.unit}</td>}
                  <td className={tdNum}>
                    {open && level >= 2
                      ? <input name={`c_${l.id}`} defaultValue={l.counted === null ? "" : String(l.counted).replace(".", ",")} inputMode="decimal" placeholder="—" className={`${inputCls} h-9 w-24 text-right`} />
                      : l.counted === null ? "—" : `${qty(l.counted)} ${l.stk_items?.unit}`}
                  </td>
                  {!hideExpected && <td className={`${tdNum} ${d && d < 0 ? "text-bad" : d && d > 0 ? "text-ok" : ""}`}>{d === null ? "" : `${d > 0 ? "+" : ""}${qty(d)}`}</td>}
                  {!hideExpected && <td className={tdNum}>{d ? <Money v={Math.round(d * (cost.get(l.item_id) ?? 0))} sign /> : ""}</td>}
                </tr>
              );
            })}
            {shown.length === 0 && <EmptyRow cols={hideExpected ? 5 : 8} text="Bu filtrede satır yok." />}
          </Table>
          {open && level >= 2 && <div><PendingSubmit className={btnSecondary}>Yazılan miktarları kaydet</PendingSubmit></div>}
        </form>

        {open && level >= 3 && (
          <form action={closeCount} className="bg-white border border-line rounded-[14px] p-4 flex flex-wrap items-center gap-4">
            <input type="hidden" name="id" value={c.id} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="zero" /> Sayılmayan kalemleri <b>0</b> kabul et (yoksa sayılmayanlara dokunulmaz)</label>
            <div className="ml-auto flex gap-2">
              <span className={btnSecondary}><ConfirmSubmit label="Sayımı iptal et" name="op" value="cancel" question="Sayım iptal edilsin mi? Stoğa hiçbir şey işlenmez." /></span>
              <PendingSubmit name="op" value="close" className={btnPrimary}>Sayımı kapat ve farkları işle</PendingSubmit>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="consume" defaultChecked /> Eksik çıkan miktarı <b>üretimde kullanıldı</b> olarak düş</label>
            <p className="basis-full text-xs text-muted">Fark, kapanış anındaki güncel stoğa göre hesaplanır; sayım sırasında yapılan giriş-çıkışlar doğru yansır. Eksikler üretim tüketimi, fazlalar sayım farkı olarak işlenir.</p>
          </form>
        )}
      </div>
    </>
  );
}
