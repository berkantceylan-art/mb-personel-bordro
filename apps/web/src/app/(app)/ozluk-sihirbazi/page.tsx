import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, Stat } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { aiAvailable } from "@/lib/dossier-ai";
import { CreateForm } from "./Steps";

const FILTERS = [["", "Tümü"], ["baslanmadi", "Başlanmadı"], ["devam", "Devam eden"], ["tamam", "Tamamlanan"], ["ayrilan", "Ayrılanlar"]] as const;

export default async function DossierHome({ searchParams }: { searchParams: Promise<{ f?: string; q?: string; tamam?: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) redirect("/");
  const sp = await searchParams;
  const sb = await createClient();
  const [{ data: emps }, { data: privs }, { data: dossiers }, { data: docs }, { data: types }, { data: hist }] = await Promise.all([
    sb.from("employees").select("id, first_name, last_name, hire_date, termination_date, status, departments(name)").order("first_name"),
    sb.from("employee_private").select("employee_id, national_id, birth_date, sgk_no"),
    sb.from("employee_dossier").select("employee_id, status, skipped, updated_at"),
    sb.from("employee_documents").select("employee_id, document_type_id"),
    sb.from("document_types").select("id, required, category").or(`company_id.is.null,company_id.eq.${s.companyId}`),
    sb.from("payroll_history").select("employee_id"),
  ]);
  const required = (types ?? []).filter((t) => t.required && ["ozluk", "isg", "saglik"].includes(t.category)).map((t) => t.id as string);
  const priv = new Map((privs ?? []).map((p) => [p.employee_id, p]));
  const dos = new Map((dossiers ?? []).map((d) => [d.employee_id, d]));
  const docsBy = new Map<string, Set<string>>();
  const docCount = new Map<string, number>();
  for (const d of docs ?? []) {
    (docsBy.get(d.employee_id) ?? docsBy.set(d.employee_id, new Set()).get(d.employee_id)!).add(d.document_type_id);
    docCount.set(d.employee_id, (docCount.get(d.employee_id) ?? 0) + 1);
  }
  const histBy = new Map<string, number>();
  for (const h of hist ?? []) histBy.set(h.employee_id, (histBy.get(h.employee_id) ?? 0) + 1);

  const rows = (emps ?? []).map((e) => {
    const p = priv.get(e.id);
    const d = dos.get(e.id);
    const have = docsBy.get(e.id) ?? new Set<string>();
    const skip = new Set<string>((d?.skipped as string[] | null) ?? []);
    const missing = required.filter((t) => !have.has(t) && !skip.has(t)).length;
    const parts = [!!p?.national_id && !!p?.birth_date, !!e.hire_date && !!p?.sgk_no, required.length ? (required.length - missing) / required.length : 1, (histBy.get(e.id) ?? 0) > 0 ? 1 : 0];
    const pct = d?.status === "done" ? 100 : Math.round((parts.reduce<number>((a, x) => a + Number(x), 0) / parts.length) * 95);
    return {
      id: e.id, name: `${e.first_name} ${e.last_name}`, dept: (e.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz",
      left: e.status === "terminated", started: !!d || (docCount.get(e.id) ?? 0) > 0, done: d?.status === "done", missing, pct, docs: docCount.get(e.id) ?? 0, slips: histBy.get(e.id) ?? 0,
    };
  });
  const nq = (sp.q ?? "").toLocaleLowerCase("tr").trim();
  const shown = rows
    .filter((r) => !nq || r.name.toLocaleLowerCase("tr").includes(nq))
    .filter((r) => sp.f === "baslanmadi" ? !r.started : sp.f === "devam" ? r.started && !r.done : sp.f === "tamam" ? r.done : sp.f === "ayrilan" ? r.left : true)
    .sort((a, b) => Number(a.done) - Number(b.done) || Number(b.started) - Number(a.started) || a.name.localeCompare(b.name, "tr"));
  const doneN = rows.filter((r) => r.done).length;
  const startedN = rows.filter((r) => r.started && !r.done).length;
  const totalDocs = rows.reduce((a, r) => a + r.docs, 0);
  const firstTodo = shown.find((r) => !r.done) ?? rows.find((r) => !r.done);
  const overall = rows.length ? Math.round((rows.reduce((a, r) => a + r.pct, 0) / rows.length)) : 0;

  return (
    <>
      <PageHeader
        title="Özlük dijitalleştirme"
        subtitle="Kâğıt klasörleri telefon kamerası ya da tarayıcıyla sisteme aktarın; yapay zekâ bilgileri okur, belgeleri ayırır"
        actions={firstTodo ? <Link href={`/ozluk-sihirbazi/${firstTodo.id}`} className="h-11 px-5 inline-flex items-center rounded-[10px] bg-brand-700 text-white font-bold">{rows.some((r) => r.started) ? "Kaldığım yerden devam →" : "Başla →"}</Link> : null}
      />
      <div className="p-4 md:p-6 flex flex-col gap-5">
        {sp.tamam && <p role="status" className="text-sm rounded-[12px] px-4 py-2.5 bg-ok-bg text-ok">Son klasör de tamamlandı.</p>}
        {!aiAvailable() && <p className="text-sm rounded-[12px] px-4 py-2.5 bg-warn-bg text-warn">Yapay zekâ anahtarı tanımlı değil; belgeler yüklenir ama otomatik okunmaz.</p>}
        <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-2">
          <div className="flex justify-between items-baseline"><span className="font-semibold text-brand-800">Genel ilerleme</span><span className="num font-bold text-brand-800">%{overall}</span></div>
          <div className="h-3 rounded-full bg-[#E8EEF5] overflow-hidden"><div className="h-full bg-ok rounded-full" style={{ width: `${overall}%` }} /></div>
        </section>
        <section className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Stat label="Personel klasörü" value={String(rows.length)} sub={`${rows.filter((r) => r.left).length} ayrılmış`} />
          <Stat label="Tamamlanan" value={String(doneN)} sub={`${startedN} devam ediyor`} />
          <Stat label="Yüklenen belge" value={String(totalDocs)} sub={`${rows.reduce((a, r) => a + r.slips, 0)} aylık eski bordro`} />
          <Stat label="Eksik evrakı olan" value={String(rows.filter((r) => r.missing > 0).length)} sub="zorunlu evraklara göre" />
        </section>

        <details className="bg-white border border-line rounded-[14px] p-4">
          <summary className="cursor-pointer font-semibold text-brand-700">+ Sistemde olmayan personelin klasörünü başlat (ayrılmış personel dahil)</summary>
          <div className="mt-3"><CreateForm /></div>
        </details>

        <div className="flex flex-wrap gap-2 items-center">
          {FILTERS.map(([k, l]) => (
            <Link key={k} href={`/ozluk-sihirbazi?${new URLSearchParams({ ...(k ? { f: k } : {}), ...(sp.q ? { q: sp.q } : {}) })}`} className={`text-[13px] px-3 py-1.5 rounded-full ${((sp.f ?? "") === k) ? "bg-brand-700 text-white font-semibold" : "bg-[#EEF2F6] text-[#33414F]"}`}>{l}</Link>
          ))}
          <form className="ml-auto flex gap-2">
            {sp.f && <input type="hidden" name="f" value={sp.f} />}
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Personel ara" aria-label="Personel ara" className="h-10 rounded-[10px] border border-[#D5DEE8] px-3 bg-white" />
          </form>
        </div>

        <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((r) => (
            <Link key={r.id} href={`/ozluk-sihirbazi/${r.id}`} className={`bg-white border rounded-[14px] p-3 flex flex-col gap-2 hover:border-brand-600 ${r.done ? "border-ok/40" : "border-line"}`}>
              <div className="flex items-center gap-3">
                <span className={`w-10 h-10 rounded-full grid place-items-center text-sm font-bold shrink-0 ${r.done ? "bg-ok text-white" : "bg-[#E8EEF5] text-brand-800"}`}>{r.done ? "✓" : r.name.split(" ").slice(0, 2).map((x) => x[0]).join("")}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold truncate">{r.name}</span>
                  <span className="block text-xs text-muted">{r.dept}{r.left ? " · ayrıldı" : ""}</span>
                </span>
                <span className="num font-bold text-sm text-brand-800">%{r.pct}</span>
              </div>
              <div className="h-1.5 rounded-full bg-[#E8EEF5] overflow-hidden"><div className={`h-full rounded-full ${r.done ? "bg-ok" : "bg-brand-600"}`} style={{ width: `${r.pct}%` }} /></div>
              <div className="flex gap-3 text-[11px] text-muted">
                <span>{r.docs} belge</span>
                <span>{r.slips} bordro</span>
                {r.missing > 0 && !r.done && <span className="text-bad font-semibold">{r.missing} eksik evrak</span>}
                {!r.started && <span className="text-warn font-semibold">başlanmadı</span>}
              </div>
            </Link>
          ))}
          {shown.length === 0 && <p className="text-sm text-muted">Bu filtrede personel yok.</p>}
        </section>
      </div>
    </>
  );
}
