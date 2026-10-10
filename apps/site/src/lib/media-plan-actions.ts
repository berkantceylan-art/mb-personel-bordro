"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSiteEditor } from "./auth";
import { buildMediaPlan } from "./media-plan";
import { createClient } from "./supabase/server";

const TABLES = ["cms_products", "cms_pages", "cms_departments"] as const;

/** Seçilen plan satırlarını uygular. Yollar sunucuda yeniden hesaplanır (formdan gelen yola güvenilmez). */
export async function applyMediaPlan(form: FormData) {
  await requireSiteEditor();
  const selected = new Set(form.getAll("row").map(String));
  if (!selected.size) redirect(`/admin/medya/otomatik?hata=${encodeURIComponent("Hiçbir satır seçilmedi.")}`);
  const { rows } = await buildMediaPlan();
  const supabase = await createClient();
  let done = 0;
  const errors: string[] = [];

  for (const r of rows.filter((x) => selected.has(x.key))) {
    const [table, id, kind] = r.key.split(":");
    if ((TABLES as readonly string[]).includes(table)) {
      const patch =
        kind === "image" ? { image_path: r.proposed[0] } : { gallery: [...new Set([...r.current, ...r.proposed])].slice(0, 24) };
      const { error } = await supabase.from(table).update(patch).eq("id", id);
      if (error) errors.push(`${r.label}: ${error.message}`);
      else done++;
    } else if (table === "cms_slides") {
      const { data: last } = await supabase.from("cms_slides").select("sort").order("sort", { ascending: false }).limit(1);
      let sort = ((last?.[0]?.sort as number | undefined) ?? 0) + 10;
      const { error } = await supabase.from("cms_slides").insert(r.proposed.map((p) => ({ placement: "home", image_path: p, sort: (sort += 10), is_active: true })));
      if (error) errors.push(`Slaytlar: ${error.message}`);
      else done++;
    } else if (table === "cms_stories") {
      const { error } = await supabase.from("cms_stories").insert({
        title: { tr: "Laboratuvarımızdan", en: "From our lab", fr: "Dans notre laboratoire" },
        frames: r.proposed.map((p) => ({ path: p, caption: {} })),
        is_active: true,
        sort: 0,
      });
      if (error) errors.push(`Hikâye: ${error.message}`);
      else done++;
    }
  }
  revalidatePath("/", "layout");
  if (errors.length) redirect(`/admin/medya/otomatik?hata=${encodeURIComponent(`${done} satır uygulandı; hatalar: ${errors.join(" · ").slice(0, 400)}`)}`);
  redirect(`/admin/medya/otomatik?ok=${encodeURIComponent(`${done} satır uygulandı. Sitede birkaç saniye içinde görünür.`)}`);
}
