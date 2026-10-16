import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CamGrid } from "../CamGrid";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kamera duvarı" };

/** Kamera duvarı: yetkili olunan tüm kameralar tek ekranda (ofis TV'si / ikinci monitör için) */
export default async function CameraWallPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("cam_cameras").select("id, name, group_name, embed_url").eq("is_active", true).order("sort").order("name");
  const cams = (data ?? []) as { id: string; name: string; group_name: string; embed_url: string }[];
  if (!cams.length) {
    return <div className="p-6 text-sm">İzleme yetkiniz olan kamera yok. <Link href="/kameralar" className="font-semibold text-brand-700">Kameralar</Link></div>;
  }
  return <div className="p-2"><CamGrid cams={cams} startWall /></div>;
}
