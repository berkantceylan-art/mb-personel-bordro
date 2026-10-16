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
  if (id) {
    const { data: old } = await supabase.from("cam_cameras").select("group_name").eq("id", id).maybeSingle();
    await supabase.from("cam_cameras").update(row).eq("id", id);
    // Grup adı değiştiyse ve eski grupta başka kamera kalmadıysa, izleme yetkileri yeni gruba taşınır
    const prev = (old as { group_name: string } | null)?.group_name;
    if (prev && prev !== row.group_name) {
      const { count } = await supabase.from("cam_cameras").select("id", { count: "exact", head: true }).eq("group_name", prev);
      if (!count) {
        const { data: acc } = await supabase.from("cam_access").select("user_id").eq("group_name", prev);
        const users = ((acc ?? []) as { user_id: string }[]).map((a) => ({ user_id: a.user_id, group_name: row.group_name }));
        if (users.length) await supabase.from("cam_access").upsert(users, { onConflict: "company_id,user_id,group_name" });
        await supabase.from("cam_access").delete().eq("group_name", prev);
      }
    }
  } else await supabase.from("cam_cameras").insert(row);
  revalidatePath("/kameralar");
}
/** Toplu ekleme: go2rtc adresi + kanal aralığı → her kanal için bir kamera (aynı adres zaten varsa atlanır) */
export async function bulkAddCameras(f: FormData) {
  const supabase = await createClient();
  let base = s(f, "base").replace(/\/+$/, "").replace(/\/stream\.html.*$/, "");
  if (!/^https:\/\/[^\s/]+/.test(base)) return;
  base = base.slice(0, 300);
  const from = Math.max(1, Math.floor(Number(s(f, "from")) || 1));
  const to = Math.min(from + 99, Math.max(from, Math.floor(Number(s(f, "to")) || from)));
  const prefix = s(f, "prefix").slice(0, 60) || "Kamera";
  const group = s(f, "group_name").slice(0, 60) || "Genel";
  const { data: existing } = await supabase.from("cam_cameras").select("embed_url");
  const have = new Set(((existing ?? []) as { embed_url: string }[]).map((e) => e.embed_url));
  const rows = [];
  for (let i = from; i <= to; i++) {
    const url = `${base}/stream.html?src=kanal${i}&mode=mse`;
    if (!have.has(url)) rows.push({ name: `${prefix} ${i}`, group_name: group, embed_url: url, sort: i });
  }
  if (rows.length) await supabase.from("cam_cameras").insert(rows);
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
