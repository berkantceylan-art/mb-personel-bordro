import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { bulkAddCameras, deleteCamera, saveCamera, setCamAccess } from "@/lib/camera-actions";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
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
        {!!list.length && <p className="text-xs text-muted">Ofis TV&apos;si / ikinci ekran için yalnız duvar sayfası: <Link href="/kameralar/duvar" className="font-semibold text-brand-700">/kameralar/duvar</Link></p>}
        {admin && (
          <details className="rounded-[16px] border border-line bg-white p-4" open={!list.length}>
            <summary className="cursor-pointer font-semibold">✎ Kamera ekle / düzenle / sil · erişim yönetimi (sahip)</summary>
            <h3 className="mt-3 font-semibold">Yeni kamera</h3>
            <form action={saveCamera} className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_2fr_80px_auto]">
              <input name="name" placeholder="Kamera adı" required className={inp} />
              <input name="group_name" placeholder="Grup (Atölye, Depo, Giriş)" list="cam-groups" className={inp} />
              <input name="embed_url" placeholder="https://kamera.sirket.com/stream.html?src=atolye1" required className={inp} />
              <input name="sort" placeholder="Sıra" inputMode="numeric" className={inp} />
              <button className="h-11 rounded-[10px] bg-brand-700 px-4 font-semibold text-white">Ekle</button>
              <datalist id="cam-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
            </form>
            <h3 className="mt-4 font-semibold">Toplu ekle <span className="text-xs font-normal text-muted">· kayıt cihazındaki kanalları tek seferde ekler (ör. 1–30); adları sonra aşağıdan değiştirebilirsiniz</span></h3>
            <form action={bulkAddCameras} className="mt-2 grid gap-2 md:grid-cols-[2fr_80px_80px_1fr_1fr_auto]">
              <input name="base" placeholder="https://berkant-mac-mini.tail000047.ts.net" defaultValue={list[0]?.embed_url.replace(/\/stream\.html.*$/, "") ?? ""} required className={`${inp} font-mono text-xs`} />
              <input name="from" defaultValue="1" aria-label="İlk kanal" inputMode="numeric" className={inp} />
              <input name="to" defaultValue="30" aria-label="Son kanal" inputMode="numeric" className={inp} />
              <input name="prefix" defaultValue="Kamera" aria-label="Ad öneki" className={inp} />
              <input name="group_name" placeholder="Grup" defaultValue="Genel" list="cam-groups" className={inp} />
              <PendingSubmit className="h-11 rounded-[10px] bg-brand-700 px-4 font-semibold text-white">Kanalları ekle</PendingSubmit>
            </form>
            {!!list.length && <h3 className="mt-4 font-semibold">Eklenen kameralar <span className="text-xs font-normal text-muted">· adı, grubu, adresi ya da sırası değiştirilip Kaydet&apos;e basılır</span></h3>}
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {list.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line p-2">
                  <form action={saveCamera} className="grid flex-1 gap-2 md:grid-cols-[1fr_1fr_2fr_80px_auto]">
                    <input type="hidden" name="id" value={c.id} />
                    <input name="name" defaultValue={c.name} aria-label="Kamera adı" required className={inp} />
                    <input name="group_name" defaultValue={c.group_name} aria-label="Grup" list="cam-groups" className={inp} />
                    <input name="embed_url" defaultValue={c.embed_url} aria-label="İzleme adresi" required className={`${inp} font-mono text-xs`} />
                    <input name="sort" defaultValue={String(c.sort)} aria-label="Sıra" inputMode="numeric" className={inp} />
                    <PendingSubmit className="h-11 rounded-[10px] border border-brand-700 px-4 font-semibold text-brand-700">Kaydet</PendingSubmit>
                  </form>
                  <form action={deleteCamera}>
                    <input type="hidden" name="id" value={c.id} />
                    <ConfirmSubmit label="Sil" question={`"${c.name}" silinsin mi?`} className="h-11 px-3 text-sm font-semibold text-bad" />
                  </form>
                </li>
              ))}
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
