import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { since } from "@/lib/flow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kontrol hattı" };

type Board = { stages: Record<string, { n: number; waiting: number; oldest: string | null }>; today: { chief: number; qc: number; packed: number; rejects: number }; techs: { name: string; rejects: number; done: number }[]; reasons: { label: string; n: number }[] };
const STEPS = [
  { key: "production", label: "Üretimde", href: "/uretim/nerede", color: "#2563EB", icon: "🛠" },
  { key: "chief", label: "Birinci kontrol", href: "/kalite-hatti/birinci", color: "#7C3AED", icon: "🔍" },
  { key: "qc", label: "Son kontrol", href: "/kalite-hatti/son", color: "#0891B2", icon: "✅" },
  { key: "dispatch", label: "Paketleme / çıkış", href: "/kalite-hatti/paket", color: "#059669", icon: "📦" },
];

/** Kontrol hattı panosu: aşamalardaki iş sayıları, bekleme, bugünkü üretim ve ret nedenleri */
export default async function QcBoard() {
  const s = await getSession();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prd_qc_board");
  if (!data && !error && (s.modules.production ?? 0) < 1) redirect("/");
  const b = (data ?? { stages: {}, today: { chief: 0, qc: 0, packed: 0, rejects: 0 }, techs: [], reasons: [] }) as Board;
  const maxR = Math.max(1, ...b.reasons.map((r) => r.n));
  return (
    <>
      <PageHeader title="Kontrol hattı" subtitle="Üretim → birinci kontrol → son kontrol → paketleme / çıkış · canlı" />
      <div className={page}>
        {error && <Notice tone="bad">Supabase&apos;de 20270108000000_qc_line.sql çalıştırılmalı.</Notice>}
        <div className="grid gap-3 md:grid-cols-4">
          {STEPS.map((st, i) => {
            const x = b.stages[st.key];
            return (
              <Link key={st.key} href={st.href} className="relative flex flex-col gap-1 rounded-[18px] border border-line bg-white p-5 hover:shadow-md" style={{ borderTop: `5px solid ${st.color}` }}>
                <span className="text-2xl">{st.icon}</span>
                <span className="text-sm font-semibold text-muted">{st.label}</span>
                <b className="text-4xl" style={{ color: st.color }}>{x?.n ?? 0}</b>
                <span className="text-xs text-muted">{x?.waiting ? `${x.waiting} sırada bekliyor` : "sıra boş"}{x?.oldest ? ` · en eski ${since(x.oldest)}` : ""}</span>
                {i < STEPS.length - 1 && <span className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 text-2xl text-muted md:block">›</span>}
              </Link>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[["Bugün 1. kontrol onayı", b.today.chief], ["Bugün son kontrol onayı", b.today.qc], ["Bugün paketlenen", b.today.packed], ["Bugün geri gönderilen", b.today.rejects]].map(([l, v]) => (
            <div key={l as string} className="rounded-[14px] border border-line bg-white p-4"><span className="text-xs text-muted">{l}</span><b className="block text-2xl">{v as number}</b></div>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-[16px] border border-line bg-white p-4">
            <h2 className="mb-3 font-display font-semibold">En sık ret nedenleri (30 gün)</h2>
            {b.reasons.map((r) => (
              <div key={r.label} className="mb-2 flex items-center gap-3 text-sm"><span className="w-40 truncate">{r.label}</span><span className="h-3 flex-1 overflow-hidden rounded-full bg-[#EEF2F6]"><span className="block h-full rounded-full bg-bad" style={{ width: `${(r.n / maxR) * 100}%` }} /></span><b className="w-8 text-right">{r.n}</b></div>
            ))}
            {!b.reasons.length && <p className="text-sm text-muted">Kayıt yok.</p>}
          </section>
          <section className="rounded-[16px] border border-line bg-white p-4">
            <h2 className="mb-3 font-display font-semibold">Teknisyene geri dönen işler (30 gün)</h2>
            <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Teknisyen</th><th className="py-1 text-right">Geri dönen</th><th className="py-1 text-right">Biten</th><th className="py-1 text-right">Oran</th></tr></thead>
              <tbody>{b.techs.map((t) => <tr key={t.name} className="border-t border-[#EEF2F6]"><td className="py-1.5">{t.name}</td><td className="py-1.5 text-right font-semibold text-bad">{t.rejects}</td><td className="py-1.5 text-right">{t.done}</td><td className="py-1.5 text-right">{t.done ? `%${Math.round((t.rejects / t.done) * 100)}` : "—"}</td></tr>)}</tbody></table>
            {!b.techs.length && <p className="text-sm text-muted">Kayıt yok.</p>}
          </section>
        </div>
      </div>
    </>
  );
}
