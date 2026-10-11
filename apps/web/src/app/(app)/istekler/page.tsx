import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Notice, Tabs } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { KIND_LABEL, MR_STATUS, mrNo, qtyFmt } from "@/lib/material";
import { cancelMaterialRequest } from "@/lib/material-actions";
import { NewRequestForm, SignReceiptForm, type CatalogItem } from "../benim/malzeme/MaterialForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "İsteklerim" };

type Req = { id: string; kind: string; year: number; no: number; status: string; reason: string | null; needed_by: string | null; decision_note: string | null; created_at: string; stk_request_lines: { id: string; name: string; unit: string; qty: number; issued_qty: number; sort: number }[] };
const TABS = [
  ["supply", "Dış sipariş", "Yazıcı kartuşu, temizlik, kırtasiye, mutfak vb. Depo sorumlusu onaylar, satın alma onaylar, kurye alır, depo size teslim eder."],
  ["asset", "Demirbaş", "Bilgisayar, sandalye, cihaz vb. Depoda boşta varsa zimmetlenir; yoksa satın almaya gider. Teslimde iki taraf imzalar ve demirbaş zimmetinize geçer."],
] as const;

/** Tüm kullanıcılar: demirbaş ve dış sipariş (kartuş / temizlik / kırtasiye) istekleri */
export default async function MyRequestsPage({ searchParams }: { searchParams: Promise<{ tur?: string }> }) {
  const s = await getSession();
  const sp = await searchParams;
  const tab = TABS.find((t) => t[0] === sp.tur) ?? TABS[0];
  const supabase = await createClient();
  const [{ data: emp }, { data: reqs, error }, { data: cat }] = await Promise.all([
    supabase.from("employees").select("id").eq("user_id", s.userId).maybeSingle(),
    supabase.from("stk_requests").select("id, kind, year, no, status, reason, needed_by, decision_note, created_at, stk_request_lines(id, name, unit, qty, issued_qty, sort)")
      .eq("requested_by", s.userId).in("kind", ["asset", "supply"]).order("created_at", { ascending: false }).limit(80),
    supabase.rpc("stk_req_catalog"),
  ]);
  const list = (reqs ?? []) as Req[];
  const toSign = list.filter((r) => r.status === "delivered");
  const shown = list.filter((r) => r.kind === tab[0]);
  const summary = (r: Req) => [...r.stk_request_lines].sort((a, b) => a.sort - b.sort).map((l) => `${l.name} × ${qtyFmt(r.status === "delivered" || r.status === "completed" ? l.issued_qty : l.qty)} ${l.unit}`).join(", ");
  const catalog = tab[0] === "supply" ? ((cat ?? []) as CatalogItem[]) : [];

  return (
    <>
      <PageHeader title="İsteklerim" subtitle="Demirbaş ve dış sipariş (kartuş, temizlik, kırtasiye…) istekleri · durumunu izleyin, teslimde imzalayın"
        actions={emp ? <Link href="/benim/malzeme" className="text-sm font-semibold text-brand-700">Depodan malzeme iste →</Link> : undefined} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[900px]">
        {error && <Notice tone="bad">Supabase&apos;de 20270105000000_request_kinds.sql çalıştırılmalı.</Notice>}
        {toSign.map((r) => <SignReceiptForm key={r.id} id={r.id} summary={`${mrNo(r)} · ${summary(r)}`} />)}
        <Tabs active={`/istekler?tur=${tab[0]}`} items={TABS.map(([k, l]) => [`/istekler?tur=${k}`, l, list.filter((r) => r.kind === k && !["completed", "rejected", "cancelled"].includes(r.status)).length])} />
        <section className="bg-white border border-line rounded-[16px] p-4 md:p-5">
          <h2 className="font-display text-lg font-bold">Yeni {tab[0] === "supply" ? "sipariş" : "demirbaş isteği"}</h2>
          <p className="mb-3 text-sm text-muted">{tab[2]}</p>
          <NewRequestForm key={tab[0]} catalog={catalog} kind={tab[0]} />
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-bold">{KIND_LABEL[tab[0]]} isteklerim</h2>
          {shown.map((r) => {
            const [label, cls] = MR_STATUS[r.status] ?? MR_STATUS.pending!;
            return (
              <article key={r.id} className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="num">{mrNo(r)}</b>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${cls}`}>{label}</span>
                  <span className="ml-auto text-xs text-muted">{formatDate(r.created_at.slice(0, 10))}{r.needed_by ? ` · lazım: ${formatDate(r.needed_by)}` : ""}</span>
                </div>
                <p className="text-sm">{summary(r)}</p>
                {r.reason && <p className="text-xs text-muted">{r.reason}</p>}
                {r.decision_note && <p className="text-xs"><b>Not:</b> {r.decision_note}</p>}
                {["pending", "purchase"].includes(r.status) && (
                  <form action={cancelMaterialRequest}><input type="hidden" name="id" value={r.id} /><button className="text-xs font-semibold text-bad hover:underline">İsteği iptal et</button></form>
                )}
              </article>
            );
          })}
          {shown.length === 0 && <p className="rounded-[14px] border border-dashed border-[#C5D0DB] p-6 text-center text-sm text-muted">Henüz istek yok.</p>}
        </section>
      </div>
    </>
  );
}
