import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { QuoteForm } from "./QuoteForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fiyat teklifi", robots: { index: false, follow: false }, referrer: "no-referrer" };

type V = { no: string; title: string; status: string; due_date: string | null; currency: string; note: string | null; supplier: string; my_status: string; delivery_days: number | null; valid_until: string | null; my_note: string | null; quoted_by: string | null; won: boolean;
  company: { name: string; phone: string | null; email: string | null } | null; lines: { id: string; name: string; qty: number; unit: string; unit_price: number | null; vat_rate: number; available: boolean; note: string | null }[] };
const d = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join(".") : "");

/** Tedarikçinin teklif verdiği sayfa (bağlantıyla, hesapsız) */
export default async function SupplierQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();
  const sb = await createClient();
  const { data } = await sb.rpc("sup_rfq_view", { p_token: token });
  const v = data as V | null;
  if (!v) notFound();
  return (
    <main className="mx-auto max-w-[900px] p-4 md:p-8 flex flex-col gap-5">
      <header className="flex flex-wrap items-start gap-4 rounded-[16px] bg-white border border-line p-5">
        <div className="flex-1 min-w-[240px]">
          <p className="text-xs font-semibold text-muted">FİYAT TEKLİFİ İSTEĞİ</p>
          <h1 className="font-display text-2xl font-bold text-brand-800">{v.title}</h1>
          <p className="text-sm text-muted">{v.no}{v.due_date ? ` · son teklif tarihi ${d(v.due_date)}` : ""} · para birimi {v.currency}</p>
        </div>
        <div className="text-sm text-right"><p className="font-bold">{v.company?.name}</p><p className="text-muted">{[v.company?.phone, v.company?.email].filter(Boolean).join(" · ")}</p></div>
      </header>
      <p className="text-sm">Sayın <b>{v.supplier}</b>, aşağıdaki kalemler için birim fiyatınızı (KDV hariç), teslim sürenizi ve teklif geçerlilik tarihini girmenizi rica ederiz.</p>
      {v.note && <p className="text-sm rounded-xl bg-[#F3F6F9] p-3">{v.note}</p>}
      {v.status === "awarded" && <p className={`rounded-xl p-3 font-semibold ${v.won ? "bg-ok-bg text-ok" : "bg-[#EEF2F6] text-muted"}`}>{v.won ? "Teklifiniz kabul edildi, siparişimiz ayrıca iletilecek. Teşekkür ederiz." : "Bu teklif isteği sonuçlandı. İlginiz için teşekkür ederiz."}</p>}
      {v.status === "cancelled" && <p className="rounded-xl p-3 bg-[#EEF2F6] text-muted font-semibold">Bu teklif isteği iptal edildi.</p>}
      <QuoteForm token={token} open={v.status === "open"} v={v} />
    </main>
  );
}
