import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { deleteUserType } from "@/lib/users-actions";
import { TypeEditor } from "../../TypeEditor";
import { Avatar, type TypeRow, type UserRow } from "../../_ui";

export const dynamic = "force-dynamic";

/** Kullanıcı türü oluştur / düzenle */
export default async function TypePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kopya?: string }> }) {
  const s = await getSession();
  const lvl = s.role === "owner" ? 3 : (s.modules.users ?? 0);
  if (lvl < 1) redirect("/");
  const { id } = await params;
  const { kopya } = await searchParams;
  const supabase = await createClient();
  const { data: td } = await supabase.rpc("user_types_list");
  const types = (td ?? []) as TypeRow[];
  const isNew = id === "yeni";
  const src = isNew ? types.find((t) => t.id === kopya) : types.find((t) => t.id === id);
  if (!isNew && !src) notFound();
  const { data: ud } = !isNew ? await supabase.rpc("users_overview") : { data: [] };
  const members = ((ud ?? []) as UserRow[]).filter((u) => u.user_type_id === id);
  const initial = src
    ? { id: isNew ? undefined : src.id, name: isNew ? `${src.name} (kopya)` : src.name, description: src.description, color: src.color, levels: src.levels, scoped: src.scoped, site_access: src.site_access, boss: src.boss, flow_role: src.flow_role }
    : { name: "", description: null, color: "#0A3D73", levels: {}, scoped: false, site_access: false, boss: false, flow_role: null };

  return (
    <>
      <PageHeader title={isNew ? "Yeni kullanıcı türü" : src!.name} subtitle={isNew ? "Görevin adını yazın, kullanacağı modülleri seçin." : `${members.length} kişi bu türde`}
        actions={<span className="flex gap-4 text-sm font-semibold">{!isNew && lvl >= 3 && <Link href={`/yonetim/turler/yeni?kopya=${id}`} className="text-brand-700">Kopyasını oluştur</Link>}<Link href="/yonetim?sekme=turler" className="text-brand-700">← Türler</Link></span>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {lvl >= 3 ? <TypeEditor initial={initial} /> : <p className="text-sm text-muted">Türleri düzenlemek için Kullanıcı yönetiminde “Türleri ve yetkileri yönetir” seviyesi gerekir.</p>}
        {!isNew && (
          <section className="rounded-[18px] border border-line bg-white p-5 flex flex-col gap-3">
            <h2 className="font-display text-lg font-bold">Bu türdeki kişiler</h2>
            <div className="flex flex-wrap gap-2">
              {members.map((u) => <Link key={u.user_id} href={`/yonetim/kullanici/${u.user_id}`} className="flex items-center gap-2 rounded-full border border-line pr-3 hover:border-brand-600"><span className="scale-75"><Avatar name={u.display_name} color={u.type_color} /></span><span className="text-sm font-semibold">{u.display_name}</span></Link>)}
              {members.length === 0 && <span className="text-sm text-muted">Henüz kimse yok. <Link href="/yonetim?sekme=hesap-ac" className="font-semibold text-brand-700">Hesap açın</Link> ya da kullanıcı listesinden tür atayın.</span>}
            </div>
            {lvl >= 3 && (
              <form action={deleteUserType} className="flex items-center gap-3 border-t border-line pt-3">
                <input type="hidden" name="id" value={id} />
                <span className="text-xs text-muted flex-1">Silinen türdeki kişilerin yetkileri olduğu gibi kalır; yalnız tür bağı kalkar.</span>
                <ConfirmSubmit label="Türü sil" question="Bu kullanıcı türü silinsin mi?" />
              </form>
            )}
          </section>
        )}
      </div>
    </>
  );
}
