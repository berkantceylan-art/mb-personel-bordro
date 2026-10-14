import { notFound } from "next/navigation";
import { AreaForm } from "@/components/admin/AreaForm";
import { Flash, PageHead } from "@/components/admin/ui";
import type { Area } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Bölge sayfası" };

export default async function AreaEdit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ hata?: string }> }) {
  const { id } = await params;
  const { hata } = await searchParams;
  if (id === "yeni") return (<><PageHead title="Yeni bölge sayfası" /><Flash hata={hata} /><AreaForm /></>);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("cms_areas").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const a = data as Area;
  return (<><PageHead title={t(a.name, "tr")} lead={`/tr/bolge/${a.slug}`} /><Flash hata={hata} /><AreaForm area={a} /></>);
}
