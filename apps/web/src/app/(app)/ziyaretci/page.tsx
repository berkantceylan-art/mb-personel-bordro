import { headers } from "next/headers";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { VIS_STATUS, visNo } from "@/lib/visitor";
import { InviteForm } from "./InviteForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ziyaretçilerim" };
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

/** Personel: misafirlerimi önceden kaydet, geldiğinde bildirim al */
export default async function MyVisitorsPage() {
  const s = await getSession();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const supabase = await createClient();
  const [{ data, error }, { data: guard }] = await Promise.all([
    supabase.from("vis_visits").select("id, year, no, visitor_name, visitor_company, status, expected_at, checked_in_at, checked_out_at, badge_no, token").or(`host_user.eq.${s.userId},created_by.eq.${s.userId}`).order("created_at", { ascending: false }).limit(60),
    supabase.rpc("vis_is_guard"),
  ]);
  const rows = (data ?? []) as { id: string; year: number; no: number; visitor_name: string; visitor_company: string | null; status: string; expected_at: string | null; checked_in_at: string | null; checked_out_at: string | null; badge_no: string | null; token: string }[];
  return (
    <>
      <PageHeader title="Ziyaretçilerim" subtitle="Misafirinizi önceden kaydedin; QR davetiyeyle girer, geldiğinde size bildirim gelir"
        actions={guard ? <Link href="/guvenlik" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">🛡 Güvenlik paneli</Link> : undefined} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[900px]">
        {error && <Notice tone="bad">Supabase&apos;de 20270110000000_visitors.sql çalıştırılmalı.</Notice>}
        <section className="bg-white border border-line rounded-[16px] p-4 md:p-5"><h2 className="font-display text-lg font-bold mb-3">Yeni misafir</h2><InviteForm origin={origin} /></section>
        <ul className="flex flex-col gap-2">
          {rows.map((v) => {
            const [l, c] = VIS_STATUS[v.status] ?? VIS_STATUS.expected!;
            return (
              <li key={v.id} className="bg-white border border-line rounded-[14px] p-4 flex flex-wrap items-center gap-3">
                <b className="num w-28">{visNo(v)}</b>
                <span className="flex-1 min-w-[160px]"><b>{v.visitor_name}</b><span className="block text-xs text-muted">{[v.visitor_company, v.expected_at ? `beklenen ${dt(v.expected_at)}` : null, v.checked_in_at ? `geldi ${dt(v.checked_in_at)}` : null, v.checked_out_at ? `çıktı ${dt(v.checked_out_at)}` : null].filter(Boolean).join(" · ")}</span></span>
                {v.status === "expected" && <a href={`/z/${v.token}`} target="_blank" className="text-xs font-semibold text-brand-700">Davetiye ↗</a>}
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${c}`}>{l}</span>
              </li>
            );
          })}
          {!rows.length && <li className="rounded-[14px] border border-dashed border-[#C5D0DB] p-6 text-center text-sm text-muted">Henüz misafir kaydınız yok.</li>}
        </ul>
      </div>
    </>
  );
}
