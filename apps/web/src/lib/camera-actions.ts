"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export async function saveCamera(f: FormData) {
  const supabase = await createClient();
  const url = s(f, "embed_url");
  if (!/^https:\/\//.test(url)) return;
  const row = { name: s(f, "name").slice(0, 80) || "Kamera", group_name: s(f, "group_name").slice(0, 60) || "Genel", embed_url: url.slice(0, 500), sort: Number(s(f, "sort")) || 0 };
  const id = s(f, "id");
  if (id) await supabase.from("cam_cameras").update(row).eq("id", id);
  else await supabase.from("cam_cameras").insert(row);
  revalidatePath("/kameralar");
}
export async function deleteCamera(f: FormData) {
  const supabase = await createClient();
  await supabase.from("cam_cameras").delete().eq("id", s(f, "id"));
  revalidatePath("/kameralar");
}
export async function setCamAccess(f: FormData) {
  const supabase = await createClient();
  const user = s(f, "user_id"), group = s(f, "group_name");
  if (s(f, "remove") === "1") await supabase.from("cam_access").delete().eq("user_id", user).eq("group_name", group);
  else if (user && group) await supabase.from("cam_access").upsert({ user_id: user, group_name: group }, { onConflict: "company_id,user_id,group_name" });
  revalidatePath("/kameralar");
}
export async function logCamView(ids: string[]) {
  const supabase = await createClient();
  await supabase.from("cam_views").insert({ camera_ids: ids.slice(0, 64) });
}
