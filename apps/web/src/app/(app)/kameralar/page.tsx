import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { deleteCamera, saveCamera, setCamAccess } from "@/lib/camera-actions";
import { CamGrid } from "./CamGrid";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kameralar" };

/** Kameralar: yetkili olduğu grupların canlı görüntüsü; sahip kameraları ve erişimi yönetir */
export default async function CamerasPage() {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: cams, error }, { data: admin }] = await Promise.all([
    supabase.from("cam_cameras").select("id, name, group_name, embed_url, sort").eq("is_active", true).order("sort").order("name"),
    supabase.rpc("cam_admin"),
  ]);
  const list = (cams ?? []) as { id: string; name: string; group_name: string; embed_url: string; sort: number }[];
  const [{ data: acc }, { data: dir }, { data: views }] = admin ? await Promise.all([
    supabase.from("cam_access").select("user_id, group_name"),
    supabase.rpc("company_directory"),
    supabase.from("cam_views").select("user_id, at, camera_ids").order("at", { ascending: false }).limit(30),
  ]) : [{ data: [] }, { data: [] }, { data: [] }];
  const names = new Map(((dir ?? []) as { user_id: string; display_name: string }[]).map((d) => [d.user_id, d.display_name]));
  const groups = [...new Set(list.map((c) => c.group_name))];
  const inp = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 text-sm";
  return (
    <>
      <PageHeader title="Kameralar" subtitle={`Canlı izleme · ${list.length} kamera · izlemeler kayıt altına alınır`} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1600px]">
        {error && <Notice tone="bad">Supabase&apos;de 20270113000000_cameras.sql çalıştırılmalı.</Notice>}
        {!list.length && !error && <Notice tone="info">{admin ? "Henüz kamera eklenmedi. Şirkette kamera kayıt cihazına bağlı bir ağ geçidi (ör. go2rtc) kurulduktan sonra her kameranın https izleme adresini aşağıdan ekleyin." : "İzleme yetkiniz olan kamera yok."}</Notice>}
        {!!list.length && <CamGrid cams={list} />}
        {admin && (
          <details className="rounded-[16px] border border-line bg-white p-4" open={!list.length}>
            <summary className="cursor-pointer font-semibold">Kamera ve erişim yönetimi (sahip)</summary>
            <form action={saveCamera} className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_2fr_80px_auto]">
              <input name="name" placeholder="Kamera adı" required className={inp} />
              <input name="group_name" placeholder="Grup (Atölye, Depo, Giriş)" list="cam-groups" className={inp} />
              <input name="embed_url" placeholder="https://kamera.sirket.com/stream.html?src=atolye1" required className={inp} />
              <input name="sort" placeholder="Sıra" inputMode="numeric" className={inp} />
              <button className="h-11 rounded-[10px] bg-brand-700 px-4 font-semibold text-white">Ekle</button>
              <datalist id="cam-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
            </form>
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {list.map((c) => <li key={c.id} className="flex items-center gap-3"><b>{c.name}</b><span className="text-muted">{c.group_name}</span><span className="flex-1 truncate text-xs text-muted">{c.embed_url}</span><form action={deleteCamera}><input type="hidden" name="id" value={c.id} /><button className="text-xs font-semibold text-bad">Sil</button></form></li>)}
            </ul>
            <h3 className="mt-4 font-semibold">Kim hangi grubu izleyebilir?</h3>
            <form action={setCamAccess} className="mt-2 flex flex-wrap gap-2">
              <select name="user_id" required className={inp}><option value="">Kullanıcı</option>{((dir ?? []) as { user_id: string; display_name: string }[]).map((d) => <option key={d.user_id} value={d.user_id}>{d.display_name}</option>)}</select>
              <select name="group_name" required className={inp}><option value="">Grup</option>{groups.map((g) => <option key={g}>{g}</option>)}</select>
              <button className="h-11 rounded-[10px] bg-brand-700 px-4 font-semibold text-white">Yetki ver</button>
            </form>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {((acc ?? []) as { user_id: string; group_name: string }[]).map((a) => <li key={a.user_id + a.group_name} className="flex items-center gap-3">{names.get(a.user_id) ?? a.user_id} → <b>{a.group_name}</b><form action={setCamAccess}><input type="hidden" name="user_id" value={a.user_id} /><input type="hidden" name="group_name" value={a.group_name} /><input type="hidden" name="remove" value="1" /><button className="text-xs font-semibold text-bad">Kaldır</button></form></li>)}
            </ul>
            <h3 className="mt-4 font-semibold">Son izlemeler</h3>
            <ul className="mt-1 text-xs text-muted">{((views ?? []) as { user_id: string; at: string; camera_ids: string[] }[]).map((v, i) => <li key={i}>{new Date(v.at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} · {names.get(v.user_id) ?? ""} · {v.camera_ids.length} kamera</li>)}</ul>
          </details>
        )}
        <p className="text-xs text-muted">Kameralar ERP&apos;ye ara cihaz (ağ geçidi) üzerinden bağlanır; şifreler ERP&apos;de saklanmaz. {s.companyName}</p>
      </div>
    </>
  );
}
