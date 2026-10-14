import { SimpleRows } from "@/components/admin/SimpleRows";
import { Flash, PageHead } from "@/components/admin/ui";
import type { Credential } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { CRED_UI } from "@/lib/pages-ui";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Belgeler ve basın" };
export default async function CredAdmin({ searchParams }: { searchParams: Promise<{ ok?: string; hata?: string }> }) {
  const { ok, hata } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("cms_credentials").select("*").is("deleted_at", null).order("sort");
  const rows = ((data ?? []) as Credential[]).map((c) => ({ id: c.id, title: t(c.title, "tr"), sub: `${CRED_UI.tr.kinds[c.kind]}${c.issuer ? ` · ${c.issuer}` : ""}${c.valid_until ? ` · geçerlilik ${c.valid_until.split("-").reverse().join(".")}` : ""}`, href: `/admin/belgeler/${c.id}`, view: "/tr/belgeler", draft: !c.is_active }));
  return (<><PageHead title="Belgeler, sertifikalar ve basın" lead="Sitede /belgeler: ISO, CE, ÜTS, oda üyeliği, ödüller, basında biz. Google ve yapay zekâ için güven sinyali." action={{ href: "/admin/belgeler/yeni", label: "Yeni kayıt" }} /><Flash ok={ok} hata={hata ?? (error ? "Supabase'de 20270204000000_site_pages_plus.sql çalıştırılmalı." : undefined)} /><SimpleRows table="cms_credentials" rows={rows} empty="Henüz kayıt yok. Sertifikalarınızı ve basın haberlerinizi ekleyin." /></>);
}
