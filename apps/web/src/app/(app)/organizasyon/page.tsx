import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { deleteTitle, deleteUnit, saveMembers, saveTitle, saveUnit, saveUnitType, seedOrg } from "./actions";

type Unit = { id: string; parent_id: string | null; type_id: string | null; name: string; code: string | null; manager_employee_id: string | null; department_id: string | null; branch_id: string | null; headcount_target: number | null; description: string | null; sort: number };
type Emp = { id: string; first_name: string; last_name: string; org_unit_id: string | null; title_id: string | null; manager_employee_id: string | null; position_title: string | null; department_id: string | null };
type UType = { id: string; company_id: string | null; name: string; level: number; color: string };
type Title = { id: string; name: string; grade: number | null; is_manager: boolean; description: string | null };

const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm w-full";
const VIEWS = [["sema", "Birim şeması"], ["kisi", "Kişi şeması"], ["unvan", "Unvanlar"], ["tip", "Birim tipleri"]] as const;

/** Organizasyon: hiyerarşik birimler, unvanlar, bağlı olunan yönetici, norm kadro */
export default async function OrgPage({ searchParams }: { searchParams: Promise<{ gorunum?: string; birim?: string; yeni?: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager", "safety"].includes(s.role)) redirect("/");
  const edit = ["owner", "hr"].includes(s.role);
  const sp = await searchParams;
  const view = (VIEWS.find(([k]) => k === sp.gorunum)?.[0] ?? "sema") as (typeof VIEWS)[number][0];
  const supabase = await createClient();
  const [{ data: unitsRaw, error }, { data: typesRaw }, { data: titlesRaw }, { data: empsRaw }, { data: depts }, { data: branches }] = await Promise.all([
    supabase.from("org_units").select("id, parent_id, type_id, name, code, manager_employee_id, department_id, branch_id, headcount_target, description, sort").eq("active", true).order("sort").order("name"),
    supabase.from("org_unit_types").select("id, company_id, name, level, color").order("level"),
    supabase.from("job_titles").select("id, name, grade, is_manager, description").order("grade", { nullsFirst: false }).order("name"),
    supabase.from("employees").select("id, first_name, last_name, org_unit_id, title_id, manager_employee_id, position_title, department_id").neq("status", "terminated").order("first_name"),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("branches").select("id, name").order("name"),
  ]);
  if (error) return (<><PageHeader title="Organizasyon" /><div className="p-6"><Card><p className="text-sm">Bu modül için Supabase&apos;de <b>20261113000000_organization.sql</b> çalıştırılmalı.</p></Card></div></>);
  const units = (unitsRaw ?? []) as Unit[];
  const types = (typesRaw ?? []) as UType[];
  const titles = (titlesRaw ?? []) as Title[];
  const emps = (empsRaw ?? []) as Emp[];
  const type = new Map(types.map((t) => [t.id, t]));
  const emp = new Map(emps.map((e) => [e.id, e]));
  const title = new Map(titles.map((t) => [t.id, t]));
  const kids = (id: string | null) => units.filter((u) => u.parent_id === id || (id === null && u.parent_id && !units.some((x) => x.id === u.parent_id)));
  // Personel birimi: atanmışsa o, yoksa bölüm eşleşmesi
  const unitOf = (e: Emp) => e.org_unit_id ?? units.find((u) => u.department_id && u.department_id === e.department_id)?.id ?? null;
  const direct = (id: string) => emps.filter((e) => unitOf(e) === id);
  const total = (id: string): number => direct(id).length + kids(id).reduce((a, k) => a + total(k.id), 0);
  const name = (e?: Emp | null) => (e ? `${e.first_name} ${e.last_name === "-" ? "" : e.last_name}`.trim() : "");
  const sel = units.find((u) => u.id === sp.birim) ?? null;
  const roots = kids(null);
  const descendants = (id: string): string[] => kids(id).flatMap((k) => [k.id, ...descendants(k.id)]);
  const unassigned = emps.filter((e) => !unitOf(e));
  const href = (o: Record<string, string | undefined>) => { const u = new URLSearchParams(Object.entries({ gorunum: view === "sema" ? undefined : view, ...o }).filter(([, v]) => v) as Array<[string, string]>); return `/organizasyon${u.toString() ? `?${u}` : ""}`; };

  const UnitCard = ({ u }: { u: Unit }) => {
    const t = u.type_id ? type.get(u.type_id) : null;
    const m = u.manager_employee_id ? emp.get(u.manager_employee_id) : null;
    const n = total(u.id);
    const over = u.headcount_target !== null ? n - u.headcount_target : 0;
    return (
      <Link href={href({ birim: u.id })} className={`block w-[176px] rounded-xl border bg-white text-left shadow-sm overflow-hidden ${sel?.id === u.id ? "border-brand-700 ring-2 ring-brand-700/30" : "border-line hover:border-brand-600"}`}>
        <span className="block h-1.5" style={{ background: t?.color ?? "#9FB3C8" }} />
        <span className="block px-3 py-2">
          <span className="block text-[10px] font-bold uppercase tracking-wide" style={{ color: t?.color ?? "#6B7785" }}>{t?.name ?? "Birim"}</span>
          <span className="block font-semibold text-sm text-ink leading-tight">{u.name}</span>
          <span className="block text-xs text-muted truncate">{m ? name(m) : "yönetici atanmadı"}</span>
          <span className="block text-xs mt-1"><b>{n}</b> kişi{u.headcount_target !== null && <span className={over < 0 ? "text-[#B54708] font-semibold" : over > 0 ? "text-bad font-semibold" : "text-ok"}> · norm {u.headcount_target}{over < 0 ? ` (${-over} açık)` : over > 0 ? ` (+${over})` : " ✓"}</span>}</span>
        </span>
      </Link>
    );
  };
  /** Alt birimi olmayan kardeşler dikey sütunlarda gösterilir (geniş şemada yatay taşmayı önler) */
  const UnitNode = ({ u }: { u: Unit }) => {
    const ch = kids(u.id);
    const branchKids = ch.filter((c) => kids(c.id).length > 0);
    const leaves = ch.filter((c) => kids(c.id).length === 0);
    const cols: Unit[][] = [];
    const per = leaves.length > 8 ? Math.ceil(leaves.length / 3) : leaves.length > 3 ? Math.ceil(leaves.length / 2) : 1;
    for (let i = 0; i < leaves.length; i += per) cols.push(leaves.slice(i, i + per));
    return (
      <li>
        <UnitCard u={u} />
        {ch.length > 0 && (
          <ul>
            {branchKids.map((c) => <UnitNode key={c.id} u={c} />)}
            {cols.map((col, i) => <li key={`c${i}`}><div className="flex flex-col gap-2">{col.map((c) => <UnitCard key={c.id} u={c} />)}</div></li>)}
          </ul>
        )}
      </li>
    );
  };
  // Kişi şeması: yönetici bağlantısı; yoksa birim yöneticisi
  const bossOf = (e: Emp): string | null => {
    if (e.manager_employee_id) return e.manager_employee_id;
    let u = units.find((x) => x.id === unitOf(e));
    while (u) {
      if (u.manager_employee_id && u.manager_employee_id !== e.id) return u.manager_employee_id;
      u = units.find((x) => x.id === u!.parent_id);
    }
    return null;
  };
  const reports = (id: string | null) => emps.filter((e) => bossOf(e) === id);
  const PersonNode = ({ e, depth }: { e: Emp; depth: number }) => {
    const r = depth < 6 ? reports(e.id) : [];
    const t = e.title_id ? title.get(e.title_id)?.name : e.position_title;
    const leaf = r.filter((x) => reports(x.id).length === 0);
    const branch = r.filter((x) => reports(x.id).length > 0);
    return (
      <li>
        <div className="w-[176px] rounded-xl border border-line bg-white px-3 py-2 text-left shadow-sm">
          <div className="font-semibold text-sm leading-tight">{name(e)}</div>
          <div className="text-xs text-muted truncate">{t ?? "—"}</div>
          {r.length > 0 && <div className="text-xs mt-1">{r.length} kişi bağlı</div>}
          {leaf.length > 0 && <details className="mt-1"><summary className="text-xs font-semibold text-brand-700 cursor-pointer">Ekip ({leaf.length})</summary><ul className="!block !p-0 mt-1 text-xs">{leaf.map((x) => <li key={x.id} className="!block !p-0 before:!hidden after:!hidden py-0.5">{name(x)}</li>)}</ul></details>}
        </div>
        {branch.length > 0 && <ul>{branch.map((c) => <PersonNode key={c.id} e={c} depth={depth + 1} />)}</ul>}
      </li>
    );
  };
  const topPeople = emps.filter((e) => !bossOf(e) && reports(e.id).length > 0);

  return (
    <>
      <PageHeader title="Organizasyon" subtitle={`${units.length} birim · ${titles.length} unvan · ${emps.length} personel`} />
      <div className="p-4 md:p-6 flex flex-col gap-4">
        <nav className="flex flex-wrap gap-1 p-1 rounded-xl bg-white border border-line self-start" aria-label="Görünüm">
          {VIEWS.map(([k, l]) => <Link key={k} href={k === "sema" ? "/organizasyon" : `/organizasyon?gorunum=${k}`} aria-current={view === k ? "page" : undefined} className={`h-10 px-4 rounded-lg grid place-items-center text-sm font-semibold ${view === k ? "bg-brand-800 text-white" : "text-brand-700"}`}>{l}</Link>)}
        </nav>

        {units.length === 0 && (
          <Card title="Organizasyon şeması henüz kurulmadı">
            <p className="text-sm">Mevcut şube ve bölümlerinizden başlangıç şemasını tek tıkla oluşturun; sonra grup, direktörlük, ekip gibi birimleri ekleyip yöneticileri ve norm kadroları girin.</p>
            {edit && <form action={seedOrg}><PendingSubmit className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Mevcut yapıdan oluştur</PendingSubmit></form>}
          </Card>
        )}

        {view === "sema" && units.length > 0 && (
          <div className="grid gap-4 xl:grid-cols-[1fr_380px] items-start">
            <Card title="Birim şeması" action={edit ? <Link href={href({ yeni: "1" })} className="text-sm font-semibold text-brand-700">+ Birim ekle</Link> : undefined}>
              <div className="overflow-x-auto pb-2"><div className="orgtree min-w-max px-2"><ul>{roots.map((u) => <UnitNode key={u.id} u={u} />)}</ul></div></div>
              {unassigned.length > 0 && <p className="text-xs text-[#B54708]">{unassigned.length} personel hiçbir birime bağlı değil: {unassigned.slice(0, 8).map((e) => name(e)).join(", ")}{unassigned.length > 8 ? "…" : ""}</p>}
            </Card>
            {(sel || sp.yeni) && edit && (
              <div className="flex flex-col gap-4">
                <Card title={sel ? sel.name : "Yeni birim"} action={<Link href={href({})} className="text-sm text-muted" aria-label="Kapat">✕</Link>}>
                  <form action={saveUnit} className="grid gap-2 text-sm">
                    {sel && <input type="hidden" name="id" value={sel.id} />}
                    <label className="flex flex-col gap-1 text-muted">Ad<input name="name" required defaultValue={sel?.name} className={input} /></label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-muted">Tip<select name="type_id" defaultValue={sel?.type_id ?? ""} className={input}><option value="">—</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
                      <label className="flex flex-col gap-1 text-muted">Kod<input name="code" defaultValue={sel?.code ?? ""} className={input} /></label>
                    </div>
                    <label className="flex flex-col gap-1 text-muted">Üst birim<select name="parent_id" defaultValue={sel?.parent_id ?? (sp.yeni && sp.birim ? sp.birim : "")} className={input}><option value="">— (en üst)</option>{units.filter((u) => !sel || (u.id !== sel.id && !descendants(sel.id).includes(u.id))).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
                    <label className="flex flex-col gap-1 text-muted">Yönetici<select name="manager" defaultValue={sel?.manager_employee_id ?? ""} className={input}><option value="">—</option>{emps.map((e) => <option key={e.id} value={e.id}>{name(e)}</option>)}</select></label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-muted">Puantaj bölümü<select name="department_id" defaultValue={sel?.department_id ?? ""} className={input}><option value="">—</option>{(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                      <label className="flex flex-col gap-1 text-muted">Şube<select name="branch_id" defaultValue={sel?.branch_id ?? ""} className={input}><option value="">—</option>{(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                    </div>
                    <label className="flex flex-col gap-1 text-muted">Norm kadro (olması gereken kişi)<input name="headcount_target" type="number" min={0} defaultValue={sel?.headcount_target ?? ""} className={input} /></label>
                    <label className="flex flex-col gap-1 text-muted">Görev tanımı / açıklama<textarea name="description" rows={2} defaultValue={sel?.description ?? ""} className={`${input} h-auto py-2`} /></label>
                    <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Kaydet</PendingSubmit>
                  </form>
                  {sel && (
                    <div className="flex flex-wrap gap-3 items-center">
                      <Link href={href({ yeni: "1", birim: sel.id })} className="text-sm font-semibold text-brand-700">+ Alt birim ekle</Link>
                      {sel.headcount_target !== null && total(sel.id) < sel.headcount_target && <Link href="/ise-alim/ilanlar" className="text-sm font-semibold text-[#B54708]">Açık kadro için ilan aç →</Link>}
                      <form action={deleteUnit} className="ml-auto"><input type="hidden" name="id" value={sel.id} /><ConfirmSubmit label="Birimi sil" question="Alt birimler ve personel üst birime taşınır. Silinsin mi?" yes="Sil" /></form>
                    </div>
                  )}
                </Card>
                {sel && (
                  <Card title={`Birim personeli · ${direct(sel.id).length}`}>
                    <form action={saveMembers} className="flex flex-col gap-2 text-sm">
                      <input type="hidden" name="unit_id" value={sel.id} />
                      {direct(sel.id).map((e) => (
                        <fieldset key={e.id} className="border-b border-[#EEF2F6] pb-2 grid gap-1">
                          <input type="hidden" name="emp" value={e.id} />
                          <legend className="font-semibold">{name(e)}{sel.manager_employee_id === e.id ? " · yönetici" : ""}</legend>
                          <div className="grid grid-cols-3 gap-1">
                            <select name={`title_${e.id}`} defaultValue={e.title_id ?? ""} className={input} aria-label={`${name(e)} unvan`}><option value="">Unvan —</option>{titles.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                            <select name={`mgr_${e.id}`} defaultValue={e.manager_employee_id ?? ""} className={input} aria-label={`${name(e)} bağlı olduğu kişi`}><option value="">Amir: birim yöneticisi</option>{emps.filter((x) => x.id !== e.id).map((x) => <option key={x.id} value={x.id}>{name(x)}</option>)}</select>
                            <select name={`unit_${e.id}`} defaultValue={unitOf(e) ?? ""} className={input} aria-label={`${name(e)} birimi`}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                          </div>
                        </fieldset>
                      ))}
                      <label className="flex flex-col gap-1 text-muted">Birime personel ekle<select name="add_employee" defaultValue="" className={input}><option value="">—</option>{emps.filter((e) => unitOf(e) !== sel.id).map((e) => <option key={e.id} value={e.id}>{name(e)}</option>)}</select></label>
                      <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold self-start">Kaydet</PendingSubmit>
                    </form>
                  </Card>
                )}
              </div>
            )}
          </div>
        )}

        {view === "kisi" && (
          <Card title="Kişi şeması (kim kime bağlı)">
            <p className="text-xs text-muted">Bağlı olunan kişi personel için ayrıca seçilmediyse birim yöneticisi kabul edilir. Yöneticisi olmayan ekip üyeleri kart içinde listelenir.</p>
            {topPeople.length === 0 ? <p className="text-sm text-muted">Birimlere yönetici atandıkça şema oluşur.</p> : <div className="overflow-x-auto pb-2"><div className="orgtree min-w-max px-2"><ul>{topPeople.map((e) => <PersonNode key={e.id} e={e} depth={0} />)}</ul></div></div>}
          </Card>
        )}

        {view === "unvan" && (
          <Card title="Unvanlar">
            <ul className="divide-y divide-[#EEF2F6]">
              {titles.map((t) => (
                <li key={t.id} className="py-2">
                  <form action={saveTitle} className="grid gap-2 sm:grid-cols-[2fr_90px_auto_2fr_auto_auto] items-center text-sm">
                    <input type="hidden" name="id" value={t.id} />
                    <input name="name" defaultValue={t.name} className={input} aria-label="Unvan" disabled={!edit} />
                    <input name="grade" type="number" min={1} defaultValue={t.grade ?? ""} placeholder="Kademe" className={input} aria-label="Kademe" disabled={!edit} />
                    <label className="flex items-center gap-1.5 text-xs whitespace-nowrap"><input type="checkbox" name="is_manager" defaultChecked={t.is_manager} disabled={!edit} className="w-4 h-4" />Yönetici</label>
                    <input name="description" defaultValue={t.description ?? ""} placeholder="Kısa görev tanımı" className={input} aria-label="Açıklama" disabled={!edit} />
                    <span className="text-xs text-muted whitespace-nowrap">{emps.filter((e) => e.title_id === t.id).length} kişi</span>
                    {edit && <span className="flex gap-2"><PendingSubmit className="h-10 px-3 rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold">Kaydet</PendingSubmit></span>}
                  </form>
                  {edit && emps.every((e) => e.title_id !== t.id) && <form action={deleteTitle} className="mt-1"><input type="hidden" name="id" value={t.id} /><button className="text-xs text-bad font-semibold">Sil</button></form>}
                </li>
              ))}
            </ul>
            {edit && (
              <form action={saveTitle} className="grid gap-2 sm:grid-cols-[2fr_90px_auto_2fr_auto] items-center text-sm border-t border-line pt-3">
                <input name="name" required placeholder="Yeni unvan (örn. Kıdemli porselen teknisyeni)" className={input} />
                <input name="grade" type="number" min={1} placeholder="Kademe" className={input} />
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="is_manager" className="w-4 h-4" />Yönetici</label>
                <input name="description" placeholder="Kısa görev tanımı" className={input} />
                <PendingSubmit className="h-10 px-3 rounded-[10px] bg-brand-700 text-white font-semibold">Ekle</PendingSubmit>
              </form>
            )}
          </Card>
        )}

        {view === "tip" && (
          <Card title="Birim tipleri">
            <p className="text-xs text-muted">Grup, şirket, şube, direktörlük, bölüm, birim, ekip hazır gelir. Kendi tiplerinizi ekleyebilirsiniz (seviye küçük olan üsttedir).</p>
            <ul className="flex flex-wrap gap-2">{types.map((t) => <li key={t.id} className="text-sm rounded-full px-3 py-1 text-white" style={{ background: t.color }}>{t.name} · {t.level}{t.company_id ? "" : " (hazır)"}</li>)}</ul>
            {edit && (
              <form action={saveUnitType} className="flex flex-wrap gap-2 items-end text-sm">
                <label className="flex flex-col gap-1 text-muted">Ad<input name="name" required className={input} /></label>
                <label className="flex flex-col gap-1 text-muted w-24">Seviye<input name="level" type="number" defaultValue={45} className={input} /></label>
                <label className="flex flex-col gap-1 text-muted w-20">Renk<input name="color" type="color" defaultValue="#2F6FB3" className="h-10 w-full rounded-[10px] border border-[#D5DEE8]" /></label>
                <PendingSubmit className="h-10 px-3 rounded-[10px] bg-brand-700 text-white font-semibold">Ekle</PendingSubmit>
              </form>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
