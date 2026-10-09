import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { annualLeaveEntitlement, formatTL, grossToNet, netToGross, paramsFor } from "@mb/core";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { PageHeader } from "@/components/ui";
import { contractsAt } from "@/lib/contracts";
import { docData, EXIT_CODES, TEMPLATES } from "@/lib/ozluk-docs";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { fetchAll } from "@/lib/timekeeping";
import { deleteDocument, uploadDocument } from "../document-actions";
import { closeAccess, finishExit, startExit } from "./actions";

const STEPS = [
  { n: 1, title: "Çıkış bilgileri", hint: "Çıkış tarihi, SGK işten ayrılış kodu ve neden. Kaydedince personel 'ayrıldı' olur; puantaj ve bordro bu tarihe kadar hesaplanır." },
  { n: 2, title: "Hesap kapatma", hint: "Cari bakiye, kullanılmayan yıllık izin, ihbar ve kıdem hesabı. Tutarlar tahminidir; mali müşavirinizle kesinleştirin." },
  { n: 3, title: "Çıkış belgeleri", hint: "Çalışma belgesi, ibraname ve fesih bildirimi personel bilgileriyle dolu iner; imzalılar yüklenir. SGK bildirgesi ve istifa dilekçesi de buraya." },
  { n: 4, title: "Erişim ve tamamlama", hint: "Mobil hesabı ve PDKS kartını kapatın, çıkışı tamamlayın." },
];
/** İhbar süresi (İş K. md. 17): kıdeme göre hafta */
const noticeWeeks = (years: number) => (years < 0.5 ? 2 : years < 1.5 ? 4 : years < 3 ? 6 : 8);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export default async function ExitWizard({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ adim?: string; brut?: string; tavan?: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const step = Math.min(4, Math.max(1, Number(sp.adim) || 1));
  const supabase = await createClient();
  const [{ data: e }, { data: priv }, { data: typesRaw }, { data: docs }, d] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name, hire_date, termination_date, termination_reason, status, position_title, card_no, user_id, departments(name)").eq("id", id).maybeSingle(),
    supabase.from("employee_private").select("birth_date").eq("employee_id", id).maybeSingle(),
    supabase.from("document_types").select("id, name, required, has_expiry, category, template_key, description, sort_order").eq("category", "cikis").order("sort_order"),
    supabase.from("employee_documents").select("id, document_type_id, file_name, file_path, uploaded_at").eq("employee_id", id).order("uploaded_at"),
    docData(supabase, id, s.companyId),
  ]);
  if (!e || !d) notFound();
  const { data: extra } = await supabase.from("employees").select("termination_code, exit_done_at, former_card_no").eq("id", id).maybeSingle();
  const { data: openAssets } = await supabase.from("asset_assignments").select("id, assets(code, name)").eq("employee_id", id).is("returned_on", null);
  const ex = (extra ?? {}) as { termination_code?: string | null; exit_done_at?: string | null; former_card_no?: string | null };
  const name = `${e.first_name} ${e.last_name === "-" ? "" : e.last_name}`.trim();
  const terminated = e.status === "terminated" && !!e.termination_date;
  const endDate = e.termination_date ?? todayIso();
  const btn = "h-11 px-4 inline-flex items-center justify-center rounded-[10px] font-semibold";

  // --- 2. adım hesapları
  let calc: null | { bal: number; openAdv: number; years: number; days: number; earned: number; used: number; unused: number; weeks: number; monthlyGross: number; dailyGross: number; kidem: number; kidemCapped: number; ihbar: number; izin: number; cap: number | null; total: number; basis: string } = null;
  if (step === 2 && e.hire_date) {
    const [rows, { data: leaves }, { data: adjs }, contracts] = await Promise.all([
      fetchAll<{ period: string; balance: number | null }>((a, b) => supabase.from("ledger_period_summary").select("period, balance").eq("employee_id", id).order("period").range(a, b)),
      supabase.from("leave_requests").select("days, leave_types!inner(code)").eq("employee_id", id).eq("status", "approved").eq("leave_types.code", "YILLIK"),
      supabase.from("leave_adjustments").select("days").eq("employee_id", id),
      contractsAt(supabase, [id], endDate),
    ]);
    const bal = rows.reduce((a, r) => a + Number(r.balance ?? 0), 0);
    const days = dayDiff(e.hire_date, endDate) + 1;
    const years = days / 365;
    const ent = annualLeaveEntitlement(e.hire_date, endDate, priv?.birth_date as string | null);
    const used = (leaves ?? []).reduce((a, l) => a + Number(l.days), 0);
    const adj = (adjs ?? []).reduce((a, l) => a + Number(l.days), 0);
    const unused = Math.max(0, ent.earned + adj - used);
    const c = contracts.get(id);
    const p = paramsFor(Number(endDate.slice(0, 4)));
    const officialGross = c ? (c.insuranceType === "MIN_WAGE" ? p.minWageGross : netToGross({ targetNet: c.fixedOfficialNet ?? 0, month: Number(endDate.slice(5, 7)), cumulativeTaxBaseBefore: 0, besRate: 0, params: p }).gross) : p.minWageGross;
    const brutParam = sp.brut ? Math.round(Number(String(sp.brut).replace(/\./g, "").replace(",", ".")) * 100) : null;
    const monthlyGross = brutParam && brutParam > 0 ? brutParam : officialGross;
    const cap = sp.tavan ? Math.round(Number(String(sp.tavan).replace(/\./g, "").replace(",", ".")) * 100) : null;
    const dailyGross = Math.round(monthlyGross / 30);
    const weeks = noticeWeeks(years);
    const kidemBase = cap ? Math.min(monthlyGross, cap) : monthlyGross;
    const kidem = years >= 1 ? Math.round(kidemBase * years) : 0;
    const ihbar = weeks * 7 * dailyGross;
    const izin = Math.round(unused * dailyGross);
    void grossToNet;
    calc = { bal, openAdv: 0, years, days, earned: ent.earned + adj, used, unused, weeks, monthlyGross, dailyGross, kidem, kidemCapped: kidem, ihbar, izin, cap, total: kidem + ihbar + izin + Math.max(0, bal), basis: c ? (c.insuranceType === "MIN_WAGE" ? "asgari ücret brütü" : "belirli net brütü") : "asgari ücret brütü" };
  }
  const tl = (k: number) => formatTL(k);
  const fmtQ = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // --- 3. adım belgeleri
  const types = (typesRaw ?? []) as Array<{ id: string; name: string; required: boolean; has_expiry: boolean; template_key: string | null; description: string | null }>;
  const byType = new Map<string, NonNullable<typeof docs>>();
  for (const x of docs ?? []) byType.set(x.document_type_id, [...(byType.get(x.document_type_id) ?? []), x]);
  const signed = new Map<string, string>();
  if (step === 3 && docs?.length) {
    const { data: urls } = await supabase.storage.from("documents").createSignedUrls(docs.map((x) => x.file_path), 600);
    (urls ?? []).forEach((u, i) => u.signedUrl && signed.set(docs[i]!.id, u.signedUrl));
  }
  const amountsQ = sp.brut || sp.tavan ? `?${new URLSearchParams({ ...(sp.brut ? { brut: sp.brut } : {}), ...(sp.tavan ? { tavan: sp.tavan } : {}) })}` : "";
  const cur = STEPS[step - 1]!;

  return (
    <>
      <PageHeader
        title={`İşten çıkış · ${name}`}
        subtitle={`${terminated ? `Çıkış ${formatDate(e.termination_date!)}` : "Aktif personel"} · Adım ${step}/4: ${cur.title}${ex.exit_done_at ? " · çıkış tamamlandı" : ""}`}
        actions={<Link href={`/personel/${id}`} className={`${btn} border border-[#D5DEE8] bg-white text-brand-700`}>Personel sayfası</Link>}
      />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1040px]">
        <ol className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {STEPS.map((st) => (
            <li key={st.n}>
              <Link href={`/personel/${id}/cikis?adim=${st.n}${amountsQ.replace("?", st.n >= 2 ? "&" : "?").replace(/^&/, "?")}`} aria-current={st.n === step ? "step" : undefined}
                className={`flex items-center gap-2 rounded-xl border p-3 text-sm font-semibold ${st.n === step ? "border-brand-700 bg-brand-700 text-white" : "border-[#D5DEE8] bg-white text-ink"}`}>
                <span className={`w-6 h-6 rounded-full grid place-items-center text-[11px] ${st.n === step ? "bg-white text-brand-700" : "bg-[#EEF2F6]"}`}>{st.n}</span>{st.title}
              </Link>
            </li>
          ))}
        </ol>

        <section className="bg-white border border-line rounded-[14px] p-5 flex flex-col gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-brand-800">{step}. {cur.title}</h2>
            <p className="text-sm text-muted mt-1 max-w-[760px]">{cur.hint}</p>
          </div>

          {step === 1 && (
            <form action={startExit} className="grid gap-4 md:grid-cols-3">
              <input type="hidden" name="employeeId" value={id} />
              <label className="flex flex-col gap-1.5 text-sm text-muted">Çıkış tarihi *<input type="date" name="termination_date" required defaultValue={e.termination_date ?? todayIso()} className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white" /></label>
              <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">SGK işten ayrılış kodu
                <select name="termination_code" defaultValue={ex.termination_code ?? ""} className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white">
                  <option value="">Seçin</option>
                  {EXIT_CODES.map(([c, l]) => <option key={c} value={c}>{c} · {l}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-3">Neden / açıklama (belgelere yazılır)<input name="termination_reason" defaultValue={e.termination_reason ?? ""} placeholder="ör. İstifa · kendi isteğiyle" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white" /></label>
              <div className="md:col-span-3 flex flex-wrap gap-3 items-center">
                <PendingSubmit className={`${btn} bg-[#B42318] text-white`}>{terminated ? "Çıkış bilgilerini güncelle" : "İşten çıkar ve devam et →"}</PendingSubmit>
                {!terminated && <span className="text-xs text-muted">Personel listesinde &quot;Ayrıldı&quot; görünür; geri almak için Düzenle sayfasındaki &quot;Yeniden işe al&quot;.</span>}
              </div>
            </form>
          )}

          {step === 2 && !calc && <p className="text-sm text-warn">İşe giriş tarihi yok; hesap yapılamadı.</p>}
          {step === 2 && calc && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                {[["Kıdem", `${calc.years.toFixed(2)} yıl`, `${calc.days} gün`], ["Cari bakiye (ödenecek)", tl(Math.max(0, calc.bal)), calc.bal < 0 ? `fazla ödeme ${tl(-calc.bal)}` : "tüm dönemler"], ["Kullanılmayan yıllık izin", `${calc.unused} gün`, `hak ${calc.earned} · kullanılan ${calc.used}`], ["İhbar süresi", `${calc.weeks} hafta`, "İş K. md. 17"]].map(([l, v, sub]) => (
                  <div key={l} className="rounded-xl border border-[#D5DEE8] p-3"><div className="text-xs text-muted">{l}</div><div className="num text-lg font-bold">{v}</div><div className="text-xs text-muted">{sub}</div></div>
                ))}
              </div>
              <form className="grid gap-3 md:grid-cols-3 items-end rounded-xl bg-[#F7F9FB] p-3">
                <input type="hidden" name="adim" value="2" />
                <label className="flex flex-col gap-1 text-sm text-muted">Hesaba esas aylık brüt<input name="brut" inputMode="decimal" defaultValue={sp.brut ?? fmtQ(calc.monthlyGross)} className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white num" /><span className="text-xs">Varsayılan: {calc.basis}. Elden kısım dâhil edilecekse toplam ücreti yazın.</span></label>
                <label className="flex flex-col gap-1 text-sm text-muted">Kıdem tazminatı tavanı<input name="tavan" inputMode="decimal" defaultValue={sp.tavan ?? ""} placeholder="dönem tavanı (TL)" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white num" /><span className="text-xs">Boşsa tavan uygulanmaz; güncel tavanı mali müşavirinizden alın.</span></label>
                <button className={`${btn} bg-brand-700 text-white`}>Yeniden hesapla</button>
              </form>
              <table className="w-full text-sm">
                <tbody>
                  {[["Kıdem tazminatı", calc.kidem, calc.years >= 1 ? `${calc.years.toFixed(2)} yıl × ${tl(calc.cap ? Math.min(calc.monthlyGross, calc.cap) : calc.monthlyGross)} (istifa ve 25/II fesihlerde ödenmez)` : "1 yılı doldurmadığı için hak etmez"],
                    ["İhbar tazminatı", calc.ihbar, `${calc.weeks} hafta × 7 × ${tl(calc.dailyGross)} günlük brüt (ihbar süresi çalıştırılırsa ödenmez)`],
                    ["Kullanılmayan izin ücreti", calc.izin, `${calc.unused} gün × ${tl(calc.dailyGross)} (brüt; vergi kesintisi uygulanır)`],
                    ["Cari bakiye (hakediş − ödenen)", Math.max(0, calc.bal), "Avans & Ödemeler'den son ödemeyi girin"]].map(([l, v, note]) => (
                    <tr key={String(l)}><td className="py-2 border-b border-[#EEF2F6] font-semibold">{l}</td><td className="py-2 border-b border-[#EEF2F6] text-right num font-bold whitespace-nowrap">{tl(Number(v))}</td><td className="py-2 border-b border-[#EEF2F6] text-xs text-muted pl-3">{note}</td></tr>
                  ))}
                  <tr><td className="py-2 font-bold">Tahmini toplam (brüt)</td><td className="py-2 text-right num font-bold text-brand-700">{tl(calc.total)}</td><td className="text-xs text-muted pl-3">İbranameye bu tutarlar yazılır; 3. adımda düzenleyebilirsiniz.</td></tr>
                </tbody>
              </table>
              <div className="flex gap-2 flex-wrap">
                <Link href={`/odemeler/yeni?personel=${id}`} className={`${btn} border border-[#D5DEE8] bg-white text-brand-700`}>Son ödemeyi gir</Link>
                <Link href={`/personel/${id}?donem=tumu`} className={`${btn} border border-[#D5DEE8] bg-white text-brand-700`}>Hareketleri gör</Link>
              </div>
            </div>
          )}

          {step === 3 && (openAssets ?? []).length > 0 && (
            <p className="text-sm rounded-lg bg-[#FFF4E0] text-[#8A5A00] p-3">
              Üzerinde {openAssets!.length} açık zimmet var: {openAssets!.map((a) => (a.assets as unknown as { name: string } | null)?.name).filter(Boolean).join(", ")}. Önce <Link href={`/zimmet?q=${encodeURIComponent(name)}`} className="font-semibold underline">Zimmet sayfasından iade alın</Link>, sonra iade tutanağını indirin.
            </p>
          )}
          {step === 3 && (
            <ul className="flex flex-col divide-y divide-[#EEF2F6]">
              {types.map((t) => {
                const files = byType.get(t.id) ?? [];
                const tpl = t.template_key ? TEMPLATES[t.template_key] : null;
                return (
                  <li key={t.id} className="py-3.5 flex flex-col gap-2">
                    <div className="flex gap-3 items-start">
                      <span aria-hidden className={`mt-1.5 w-3 h-3 rounded-full shrink-0 ${files.length ? "bg-[#1E7A4C]" : t.required ? "bg-[#B42318]" : "bg-[#C5D0DC]"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold">{t.name}{!t.required && <span className="text-muted font-normal"> · gerekirse</span>}</div>
                        {t.description && <div className="text-xs text-muted">{t.description}</div>}
                        {files.map((f) => (
                          <div key={f.id} className="flex gap-2 items-center text-xs mt-1">
                            <a href={signed.get(f.id) ?? "#"} target="_blank" rel="noreferrer" className="text-brand-700 font-semibold truncate">{f.file_name ?? "Dosya"}</a>
                            <span className="text-muted num">{formatDate(f.uploaded_at.slice(0, 10))}</span>
                            <form action={deleteDocument}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="employeeId" value={id} /><ConfirmSubmit label="Sil" question="Dosya silinsin mi?" className="text-bad font-semibold" /></form>
                          </div>
                        ))}
                      </div>
                      {tpl && <a href={`/personel/${id}/belge/${t.template_key}${amountsQ}`} className={`${btn} border border-[#D5DEE8] bg-white text-brand-700 text-sm whitespace-nowrap`}>Dolu belgeyi indir</a>}
                    </div>
                    <form action={uploadDocument} className="flex flex-wrap gap-2 items-center pl-6">
                      <input type="hidden" name="employeeId" value={id} /><input type="hidden" name="typeId" value={t.id} /><input type="hidden" name="next" value={`/personel/${id}/cikis?adim=3`} />
                      <input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.heic" aria-label={`${t.name} yükle`} className="text-sm max-w-64" />
                      <button className="h-10 px-3.5 rounded-lg border border-[#D5DEE8] text-sm font-semibold text-brand-700">{files.length ? "Bir dosya daha yükle" : "İmzalı belgeyi yükle"}</button>
                    </form>
                  </li>
                );
              })}
              {types.length === 0 && <li className="py-6 text-center text-muted">Çıkış belge türleri yok (Supabase: 20261101000000_profile_office_exit.sql).</li>}
            </ul>
          )}
          {step === 3 && <p className="text-xs text-muted">İbranamedeki tutarlar 2. adımdaki hesaptan gelir; önce orada &quot;Yeniden hesapla&quot; yapın. İbraname, ödemeler yapıldıktan sonra imzalatılır (TBK md. 420: fesihten en az 1 ay sonra, banka yoluyla ödeme).</p>}

          {step === 4 && (
            <div className="flex flex-col gap-4">
              <dl className="grid gap-x-6 gap-y-2 md:grid-cols-2 text-sm">
                {[["Durum", terminated ? `Ayrıldı · ${formatDate(e.termination_date!)}` : "Hâlâ aktif (1. adımı tamamlayın)"], ["Açık zimmet", (openAssets ?? []).length ? `${openAssets!.length} demirbaş iade alınmadı!` : "yok"], ["SGK çıkış kodu", ex.termination_code ?? "—"], ["Mobil hesap", e.user_id ? "Açık" : "Kapalı"], ["PDKS kartı", e.card_no ?? (ex.former_card_no ? `kaldırıldı (eski ${ex.former_card_no})` : "—")],
                  ["Çıkış belgeleri", `${types.filter((t) => byType.has(t.id)).length}/${types.length} yüklendi`]].map(([k, v]) => (
                  <div key={k} className="flex gap-3 border-b border-[#EEF2F6] py-1.5"><dt className="text-muted w-40 shrink-0">{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
              {(e.user_id || e.card_no) && (
                <form action={closeAccess}><input type="hidden" name="employeeId" value={id} /><ConfirmSubmit label="Mobil hesabı ve PDKS kartını kapat" question="Personel uygulamaya giremez, kartı okutamaz. Devam?" className={`${btn} border border-[#B42318] text-bad bg-white`} /></form>
              )}
              <p className="text-xs text-muted">SGK işten ayrılış bildirgesini (10 gün içinde) e-Bildirge&apos;den verip 3. adıma yükleyin. İŞKUR&apos;a bildirim gerekiyorsa mali müşavirinizle görüşün.</p>
            </div>
          )}
        </section>

        <div className="flex flex-wrap justify-between gap-2">
          {step > 1 ? <Link href={`/personel/${id}/cikis?adim=${step - 1}`} className={`${btn} border border-[#D5DEE8] bg-white text-brand-700`}>← {STEPS[step - 2]!.title}</Link> : <span />}
          {step < 4 ? (
            <Link href={`/personel/${id}/cikis?adim=${step + 1}${amountsQ.replace("?", "&")}`} className={`${btn} bg-brand-700 text-white`}>{STEPS[step]!.title} →</Link>
          ) : (
            <form action={finishExit}><input type="hidden" name="employeeId" value={id} /><PendingSubmit className={`${btn} bg-[#1E7A4C] text-white`}>Çıkışı tamamla ✓</PendingSubmit></form>
          )}
        </div>
      </div>
    </>
  );
}
