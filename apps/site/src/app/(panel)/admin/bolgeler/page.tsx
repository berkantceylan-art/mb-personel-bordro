import Link from "next/link";
import { Flash, PageHead } from "@/components/admin/ui";
import type { Area } from "@/lib/cms";
import { deleteArea } from "@/lib/growth-actions";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Şehir ve ülke sayfaları" };

export default async function AreasAdmin({ searchParams }: { searchParams: Promise<{ ok?: string; hata?: string }> }) {
  const { ok, hata } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("cms_areas").select("*").is("deleted_at", null).order("kind").order("sort");
  const rows = (data ?? []) as Area[];
  return (
    <>
      <PageHead title="Şehir ve ülke sayfaları" lead="“İstanbul diş laboratuvarı”, “laboratoire dentaire Turquie” gibi aramalar ve yapay zekâ cevapları için bölge sayfaları (/bolge/…)." action={{ href: "/admin/bolgeler/yeni", label: "Yeni bölge" }} />
      <Flash ok={ok} hata={hata ?? (error ? "Supabase'de 20270201000000_site_growth_seo.sql çalıştırılmalı." : undefined)} />
      <ul className="divide-y divide-gypsum rounded-2xl border border-gypsum bg-white">
        {rows.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 p-4">
            <span className="rounded-full bg-porcelain px-2.5 py-0.5 text-xs font-semibold text-slate">{a.kind === "city" ? "Şehir" : "Ülke"}</span>
            <Link href={`/admin/bolgeler/${a.id}`} className="font-semibold text-navy hover:underline">{t(a.name, "tr")}</Link>
            <span className="text-xs text-slate">/bolge/{a.slug}{a.shipping_days !== null ? ` · ${a.shipping_days} iş günü` : ""}{t(a.body, "tr") ? " · özel içerik" : " · şablon metin"}</span>
            {!a.is_active && <span className="text-xs font-semibold text-bad">taslak</span>}
            <span className="ml-auto flex gap-3 text-sm">
              <a href={`/tr/bolge/${a.slug}`} target="_blank" rel="noreferrer" className="text-slate hover:text-navy">Gör ↗</a>
              <form action={deleteArea}><input type="hidden" name="id" value={a.id} /><button className="text-bad">Kaldır</button></form>
            </span>
          </li>
        ))}
        {!rows.length && <li className="p-8 text-center text-slate">Henüz bölge yok.</li>}
      </ul>
    </>
  );
}
