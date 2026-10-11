import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { formatDate } from "@/lib/session";
import { MR_STATUS, mrNo, qtyFmt } from "@/lib/material";
import { cancelMaterialRequest } from "@/lib/material-actions";
import { NotLinked, me } from "../_shared";
import { NewRequestForm, SignReceiptForm, type CatalogItem } from "./MaterialForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Malzeme isteklerim" };

type Req = { id: string; year: number; no: number; status: string; reason: string | null; needed_by: string | null; decision_note: string | null; created_at: string; stk_request_lines: { id: string; name: string; unit: string; qty: number; issued_qty: number; sort: number }[] };

/** Personel: depodan malzeme iste, durumunu izle, teslimde imzala */
export default async function MyMaterialPage() {
  const { supabase, me: emp } = await me();
  if (!emp) return <NotLinked title="Malzeme isteklerim" />;
  const [{ data: cat, error }, { data: reqs }] = await Promise.all([
    supabase.rpc("stk_req_catalog"),
    supabase.from("stk_requests").select("id, year, no, status, reason, needed_by, decision_note, created_at, stk_request_lines(id, name, unit, qty, issued_qty, sort)").eq("employee_id", emp.id).order("created_at", { ascending: false }).limit(50),
  ]);
  const list = (reqs ?? []) as Req[];
  const toSign = list.filter((r) => r.status === "delivered");
  const summary = (r: Req) => [...r.stk_request_lines].sort((a, b) => a.sort - b.sort).map((l) => `${l.name} × ${qtyFmt(r.status === "delivered" || r.status === "completed" ? l.issued_qty : l.qty)} ${l.unit}`).join(", ");

  return (
    <>
      <PageHeader title="Malzeme isteklerim" subtitle="Depodan malzeme isteyin; depoda yoksa satın almaya gider. Teslimde depo sorumlusu ve siz imzalarsınız." />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[900px]">
        {error && <Notice tone="bad">Supabase&apos;de 20270102000000_material_requests.sql çalıştırılmalı.</Notice>}
        {toSign.map((r) => <SignReceiptForm key={r.id} id={r.id} summary={`${mrNo(r)} · ${summary(r)}`} />)}
        <section className="bg-white border border-line rounded-[16px] p-4 md:p-5">
          <h2 className="font-display text-lg font-bold mb-3">Yeni istek</h2>
          <NewRequestForm catalog={(cat ?? []) as CatalogItem[]} />
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-bold">İsteklerim</h2>
          {list.map((r) => {
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
          {list.length === 0 && <p className="rounded-[14px] border border-dashed border-[#C5D0DB] p-6 text-center text-sm text-muted">Henüz malzeme istemediniz.</p>}
        </section>
      </div>
    </>
  );
}
