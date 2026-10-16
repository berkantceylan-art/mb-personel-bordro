import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { NewAgent, ToggleAgent } from "./AgentSetup";

export const dynamic = "force-dynamic";
export const metadata = { title: "PDKS otomatik aktarım" };

type Agent = { id: string; name: string; is_active: boolean; last_seen_at: string | null; created_at: string;
  last_result: { at?: string; ok?: boolean; read?: number; inserted?: number; dup?: number; errors?: number; unknown?: string[]; message?: string; note?: string } | null };

const ago = (iso: string | null) => {
  if (!iso) return "hiç bağlanmadı";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "az önce" : m < 60 ? `${m} dk önce` : m < 1440 ? `${Math.round(m / 60)} saat önce` : `${Math.round(m / 1440)} gün önce`;
};

/** Erom PDKS: ofis bilgisayarındaki aktarıcı 5 dakikada bir okutmaları gönderir */
export default async function PdksAutoPage() {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) redirect("/puantaj");
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "erp.mbdentaire.com"}`;
  const sb = await createClient();
  const { data, error } = await sb.from("pdks_agents").select("id, name, is_active, last_seen_at, last_result, created_at").order("created_at");
  const agents = (data ?? []) as Agent[];

  return (
    <>
      <PageHeader title="PDKS otomatik aktarım" subtitle="Erom cihazlarının okutmaları 5 dakikada bir kendiliğinden puantaja gelir" actions={<Link href="/puantaj" className="text-sm font-semibold text-brand-700">← Puantaj</Link>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1000px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{/pdks_agents/.test(error.message) ? "Supabase'de 20270238000000_pdks_agent.sql çalıştırılmalı." : error.message}</p>}

        <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2 text-sm">
          <h2 className="font-display text-lg font-bold">Nasıl çalışır?</h2>
          <ol className="list-decimal pl-5 flex flex-col gap-1">
            <li>Erom&apos;un <b>Bilgi Aktar ZK</b> programı 5 dakikada bir cihazlardan (giriş 192.168.1.201, çıkış 192.168.1.224) okutmaları çekip <span className="font-mono text-xs">hareketler.txt</span> dosyasına yazar. Bu program açık kalmalıdır.</li>
            <li>Aynı bilgisayardaki <b>MB Dental PDKS aktarıcı</b> 5 dakikada bir bu dosyayı ERP&apos;ye gönderir.</li>
            <li>Aynı okutma iki kez eklenmez; bilgisayar kapalı kalsa bile açılınca eksikler gelir.</li>
          </ol>
          <p className="text-muted">Kurulum: aşağıdan anahtar oluşturup <b>ayar.json</b>&apos;ı indirin; aktarıcı dosyalarını (<a className="text-brand-700 font-semibold" href="/pdks-aktarici/kurulum.cmd" download>kurulum.cmd</a>, <a className="text-brand-700 font-semibold" href="/pdks-aktarici/aktarici.ps1" download>aktarici.ps1</a>, <a className="text-brand-700 font-semibold" href="/pdks-aktarici/gizli.vbs" download>gizli.vbs</a>) aynı klasöre indirip <b>kurulum.cmd</b>&apos;ye çift tıklayın. Kurulum, Bilgi Aktar&apos;ı da Windows açılışına ekler.</p>
        </section>

        <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
          <h2 className="font-display text-lg font-bold">Yeni bilgisayar bağla</h2>
          <NewAgent origin={origin} />
        </section>

        {agents.length > 0 && (
          <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
            <h2 className="font-display text-lg font-bold">Bağlı bilgisayarlar</h2>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="py-2 pr-3">Bilgisayar</th><th className="pr-3">Son bağlantı</th><th className="pr-3">Son sonuç</th><th /></tr></thead>
              <tbody>
                {agents.map((a) => {
                  const r = a.last_result;
                  const stale = a.is_active && (!a.last_seen_at || Date.now() - Date.parse(a.last_seen_at) > 30 * 60000);
                  return (
                    <tr key={a.id} className="border-t border-[#EEF2F6] align-top">
                      <td className="py-2 pr-3 font-semibold">{a.name}{!a.is_active && <span className="ml-2 text-xs text-muted">(durduruldu)</span>}</td>
                      <td className={`pr-3 ${stale ? "text-bad font-semibold" : ""}`}>{ago(a.last_seen_at)}{stale && a.last_seen_at ? " — bilgisayar kapalı olabilir" : ""}</td>
                      <td className="pr-3 text-muted">
                        {r ? (r.note ?? r.message ?? "") : "—"}
                        {r?.unknown && r.unknown.length > 0 && <div className="text-xs text-[#9A3412]">Tanımsız kart: {r.unknown.join(", ")} (personel kartına kart no girin)</div>}
                      </td>
                      <td><ToggleAgent id={a.id} active={a.is_active} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </>
  );
}
