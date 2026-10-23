import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { formatTL } from "@mb/core";
import { PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { EXIT_CODES } from "@/lib/ozluk-docs";
import { aiAvailable } from "@/lib/dossier-ai";
import { dossDeleteDoc, dossDone, dossToggleSkip } from "@/lib/dossier-actions";
import { Capture } from "../Capture";
import { ExitForm, HireStep, IdentityStep, LeavesStep, PhonePanel, SlipsStep, TypeSelect } from "../Steps";

export const maxDuration = 60;

const STEPS = ["Kimlik ve iletişim", "İşe giriş ve ücret", "Belgeler", "Eski bordrolar", "İzinler", "Çıkış ve özet"] as const;
const dt = (d: string | null) => (d ? d.split("-").reverse().join(".") : "—");
const CAT: Record<string, string> = { ozluk: "Özlük", isg: "İSG", saglik: "Sağlık", bordro: "Bordro", cikis: "Çıkış" };

export default async function DossierWizard({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ adim?: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const step = Math.min(6, Math.max(1, Number(sp.adim) || 1));
  const sb = await createClient();

  const [{ data: e }, { data: p }, { data: dossier }, { data: docs }, { data: types }, { data: depts }, { count: contracts }, { data: hist }, { data: leaves }, { data: leaveTypes }, { data: all }] = await Promise.all([
    sb.from("employees").select("id, first_name, last_name, hire_date, termination_date, termination_code, termination_reason, status, card_no, position_title, department_id, contract_type, sgk_occupation_code, is_retired, departments(name)").eq("id", id).maybeSingle(),
    sb.from("employee_private").select("*").eq("employee_id", id).maybeSingle(),
    sb.from("employee_dossier").select("status, skipped, done_at").eq("employee_id", id).maybeSingle(),
    sb.from("employee_documents").select("id, document_type_id, file_path, file_name, expires_on, uploaded_at, source, pages, doc_date, period, ai_data").eq("employee_id", id).order("uploaded_at", { ascending: false }),
    sb.from("document_types").select("id, name, category, required, has_expiry, sort_order").or(`company_id.is.null,company_id.eq.${s.companyId}`).order("sort_order"),
    sb.from("departments").select("id, name").order("name"),
    sb.from("pay_contracts").select("id", { count: "exact", head: true }).eq("employee_id", id),
    sb.from("payroll_history").select("period, gross, net, net_paid, cumulative_tax_base_after").eq("employee_id", id).order("period", { ascending: false }),
    sb.from("leave_requests").select("id, start_date, end_date, days, status, leave_types(name)").eq("employee_id", id).eq("status", "approved").order("start_date", { ascending: false }).limit(60),
    sb.from("leave_types").select("code, name, sort_order").order("sort_order"),
    sb.from("employees").select("id, first_name, last_name").order("first_name"),
  ]);
  if (!e) redirect("/ozluk-sihirbazi");
  const name = `${e.first_name} ${e.last_name}`;
  const priv = (p ?? {}) as Record<string, unknown>;
  const s2 = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const typeList = (types ?? []) as Array<{ id: string; name: string; category: string; required: boolean; has_expiry: boolean }>;
  const docList = docs ?? [];
  const { data: signed } = docList.length ? await sb.storage.from("documents").createSignedUrls([...new Set(docList.map((d) => d.file_path as string))], 1800) : { data: [] };
  const urlOf = new Map((signed ?? []).map((u) => [u.path, u.signedUrl]));
  // Telefondan okunmuş ama henüz onaylanmamış bordro / izin satırları
  const histPeriods = new Set((hist ?? []).map((r) => r.period as string));
  const pendingSlips: Array<Record<string, unknown>> = [];
  const pendingLeaves: Array<{ type: string; start: string; end: string; days: string; documentId: string }> = [];
  const leaveStarts = new Set((leaves ?? []).map((l) => l.start_date as string));
  for (const d of docList) {
    const ai = d.ai_data as { slips?: Array<Record<string, unknown>>; period?: string; leaves?: Array<{ type?: string; start?: string; end?: string; days?: number }> } | null;
    if (!ai) continue;
    const slips = ai.slips ?? (ai.period ? [ai as Record<string, unknown>] : []);
    for (const sl of slips) if (typeof sl.period === "string" && !histPeriods.has(sl.period) && !pendingSlips.some((x) => x.period === sl.period)) pendingSlips.push({ ...sl, documentId: d.id });
    for (const l of ai.leaves ?? []) if (l.start && !leaveStarts.has(l.start)) pendingLeaves.push({ type: l.type ?? "YILLIK", start: l.start, end: l.end ?? l.start, days: l.days ? String(l.days) : "", documentId: d.id });
  }
  pendingSlips.sort((a, b) => String(a.period).localeCompare(String(b.period)));
  const haveType = new Set(docList.map((d) => d.document_type_id as string));
  const skipped = new Set<string>((dossier?.skipped as string[] | null) ?? []);
  // askerlik durum belgesi yalnız erkek personelden istenir
  const female = /^k/i.test(String(priv.gender ?? ""));
  const required = typeList.filter((t) => t.required && ["ozluk", "isg", "saglik"].includes(t.category) && !(female && /askerlik/i.test(t.name)));
  const missing = required.filter((t) => !haveType.has(t.id) && !skipped.has(t.id));
  const identityOk = !!priv.national_id && !!priv.birth_date;
  const hireOk = !!e.hire_date && !!priv.sgk_no;
  const done = dossier?.status === "done";
  const list = (all ?? []).map((x) => ({ id: x.id, name: `${x.first_name} ${x.last_name}` })).sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const idx = list.findIndex((x) => x.id === id);
  const nextEmp = list[idx + 1];

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "erp.mbdentaire.com";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const phoneUrl = `${proto}://${host}/ozluk-sihirbazi/${id}/telefon`;
  const qr = await QRCode.toDataURL(phoneUrl, { margin: 1, width: 320 });
  const href = (n: number) => `/ozluk-sihirbazi/${id}?adim=${n}`;
  const stepState = [identityOk, hireOk, missing.length === 0, (hist ?? []).length > 0, (leaves ?? []).length > 0, done];
  const btn = "h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700";

  return (
    <>
      <PageHeader
        title={`Özlük klasörü · ${name}`}
        subtitle={`${(e.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz"} · işe giriş ${dt(e.hire_date)}${e.termination_date ? ` · çıkış ${dt(e.termination_date)}` : ""} · ${docList.length} belge${done ? " · klasör tamam ✓" : ""}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Link href="/ozluk-sihirbazi" className={btn}>← Tüm klasörler</Link>
            <Link href={`/personel/${id}`} className={btn}>Personel kartı</Link>
            {nextEmp && <Link href={`/ozluk-sihirbazi/${nextEmp.id}`} className={btn}>Sıradaki: {nextEmp.name.split(" ")[0]} →</Link>}
          </div>
        }
      />
      <div className="p-4 md:p-6 flex flex-col gap-4">
        {!aiAvailable() && <p className="text-sm rounded-[12px] px-4 py-2.5 bg-warn-bg text-warn">Yapay zekâ anahtarı (ANTHROPIC_API_KEY) tanımlı değil: belgeler yüklenir ama otomatik okunmaz; bilgileri elle girin, belge türlerini listeden seçin.</p>}
        <PhonePanel qr={qr} url={phoneUrl} />

        <nav className="flex gap-1 overflow-x-auto" aria-label="Sihirbaz adımları">
          {STEPS.map((t, i) => (
            <Link key={t} href={href(i + 1)} aria-current={step === i + 1 ? "step" : undefined}
              className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-[10px] text-sm border ${step === i + 1 ? "bg-brand-700 text-white border-brand-700" : "bg-white border-line text-[#33414F]"}`}>
              <span className={`w-6 h-6 rounded-full grid place-items-center text-xs font-bold ${stepState[i] ? "bg-ok text-white" : step === i + 1 ? "bg-white/25" : "bg-[#E3E9F0] text-muted"}`}>{stepState[i] ? "✓" : i + 1}</span>
              <span className="font-semibold">{t}</span>
            </Link>
          ))}
        </nav>

        <section className="bg-white border border-line rounded-[14px] p-4 md:p-5 flex flex-col gap-4">
          {step === 1 && (
            <IdentityStep employeeId={id} companyId={s.companyId} nextHref={href(2)} initial={{
              first_name: e.first_name, last_name: e.last_name === "-" ? "" : e.last_name, national_id: s2(priv.national_id), birth_date: s2(priv.birth_date), birth_place: s2(priv.birth_place),
              father_name: s2(priv.father_name), mother_name: s2(priv.mother_name), gender: s2(priv.gender), marital_status: s2(priv.marital_status), children_count: s2(priv.children_count),
              blood_type: s2(priv.blood_type), education: s2(priv.education), phone: s2(priv.phone), email: s2(priv.email), address: s2(priv.address),
              emergency_contact_name: s2(priv.emergency_contact_name), emergency_contact_phone: s2(priv.emergency_contact_phone), iban: s2(priv.iban), military_status: s2(priv.military_status), driving_license: s2(priv.driving_license),
            }} />
          )}

          {step === 2 && (
            <HireStep employeeId={id} companyId={s.companyId} nextHref={href(3)} hasContract={(contracts ?? 0) > 0} departments={(depts ?? []).map((d) => ({ id: d.id, name: d.name }))} initial={{
              hire_date: s2(e.hire_date), sgk_no: s2(priv.sgk_no), card_no: s2(e.card_no), sgk_occupation_code: s2(e.sgk_occupation_code), department_id: s2(e.department_id),
              position_title: s2(e.position_title), contract_type: s2(e.contract_type) || "belirsiz", is_retired: String(!!e.is_retired),
            }} />
          )}

          {step === 3 && (
            <div className="grid gap-5 lg:grid-cols-[360px_1fr] items-start">
              <div className="flex flex-col gap-3">
                <Capture employeeId={id} companyId={s.companyId} mode="docs" autoUpload title="Klasördeki evrakları okut" hint="Sayfaları art arda çekin ya da tarayıcıdan tüm klasörü tek PDF yükleyin; sistem her belgeyi tanıyıp ayırır." />
                <div className="rounded-[14px] border border-line p-3 flex flex-col gap-1">
                  <div className="flex justify-between items-baseline"><span className="font-semibold text-brand-800 text-sm">Zorunlu evrak kontrolü</span><span className={`text-xs font-semibold ${missing.length ? "text-bad" : "text-ok"}`}>{missing.length ? `${missing.length} eksik` : "tamam"}</span></div>
                  <ul className="flex flex-col">
                    {required.map((t) => {
                      const has = haveType.has(t.id);
                      const skip = skipped.has(t.id);
                      return (
                        <li key={t.id} className="flex items-center gap-2 py-1 border-b border-[#EEF2F6] last:border-0 text-[13px]">
                          <span className={`w-5 h-5 rounded-full grid place-items-center text-[11px] font-bold shrink-0 ${has ? "bg-ok text-white" : skip ? "bg-[#E3E9F0] text-muted" : "bg-bad-bg text-bad"}`}>{has ? "✓" : skip ? "–" : "!"}</span>
                          <span className={`flex-1 ${skip ? "line-through text-muted" : ""}`}>{t.name}</span>
                          {!has && (
                            <form action={dossToggleSkip}><input type="hidden" name="employeeId" value={id} /><input type="hidden" name="typeId" value={t.id} /><button className="text-[11px] text-muted underline">{skip ? "geri al" : "yok"}</button></form>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
              <div className="flex flex-col gap-2 min-w-0">
                <h3 className="font-semibold text-brand-800">Kayıtlı belgeler ({docList.length})</h3>
                {docList.length ? (
                  <ul className="flex flex-col">
                    {docList.map((d) => {
                      const ai = d.ai_data as { confidence?: number } | null;
                      const low = typeof ai?.confidence === "number" && ai.confidence < 0.6;
                      return (
                        <li key={d.id} className={`flex flex-wrap items-center gap-3 py-2 border-b border-[#EEF2F6] text-sm ${low ? "bg-warn-bg/50" : ""}`}>
                          <a href={urlOf.get(d.file_path) ?? "#"} target="_blank" rel="noopener" className="font-semibold text-brand-700 truncate max-w-[220px]" title={d.file_name ?? ""}>{d.file_name ?? "belge"}</a>
                          <TypeSelect id={d.id} employeeId={id} typeId={d.document_type_id} types={typeList.map((t) => ({ id: t.id, name: `${CAT[t.category] ?? t.category} · ${t.name}` }))} />
                          <span className="text-xs text-muted">{d.pages ? `${d.pages} sf` : ""}{d.doc_date ? ` · ${dt(d.doc_date)}` : ""}{d.expires_on ? ` · bitiş ${dt(d.expires_on)}` : ""}{d.period ? ` · ${d.period}` : ""}{d.source === "camera" ? " · 📷" : d.source === "scan" ? " · 🗂" : ""}{low ? " · tür emin değil" : ""}</span>
                          <form action={dossDeleteDoc} className="ml-auto"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="employeeId" value={id} /><ConfirmSubmit label="Sil" question="Belge silinsin mi?" className="h-8 px-3 rounded-lg border border-[#D5DEE8] text-xs font-semibold text-[#33414F] bg-white" /></form>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="text-sm text-muted">Henüz belge yok. Soldan çekmeye başlayın.</p>}
                <div className="flex justify-end pt-2"><Link href={href(4)} className="h-11 px-5 inline-flex items-center rounded-[10px] bg-brand-700 text-white font-semibold">Eski bordrolar →</Link></div>
              </div>
            </div>
          )}

          {step === 4 && (
            <>
              {(hist ?? []).length > 0 && (
                <div className="flex flex-col gap-1">
                  <h3 className="font-semibold text-brand-800 text-sm">Kayıtlı eski bordrolar ({(hist ?? []).length} ay)</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {(hist ?? []).map((r) => <span key={r.period} className="text-xs px-2.5 py-1 rounded-full bg-[#EEF4FB] text-brand-800"><b>{r.period}</b> · net {formatTL(Number(r.net))}</span>)}
                  </div>
                </div>
              )}
              <SlipsStep key={pendingSlips.length} employeeId={id} companyId={s.companyId} canSave={["owner", "accountant"].includes(s.role)} initialRows={pendingSlips} />
              <p className="text-xs text-muted">Bu yılın bordroları kaydedilince gelir vergisi kümülatif matrahı tahmin yerine bu rakamlardan hesaplanır. Bordro dosyaları personel kartında &quot;Bordrolarım&quot;a da düşer.</p>
              <div className="flex justify-end"><Link href={href(5)} className="h-11 px-5 inline-flex items-center rounded-[10px] bg-brand-700 text-white font-semibold">İzinler →</Link></div>
            </>
          )}

          {step === 5 && (
            <>
              {(leaves ?? []).length > 0 && (
                <div className="flex flex-col gap-1">
                  <h3 className="font-semibold text-brand-800 text-sm">Kayıtlı izinler ({(leaves ?? []).length})</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {(leaves ?? []).map((l) => <span key={l.id} className="text-xs px-2.5 py-1 rounded-full bg-[#EEF4FB] text-brand-800">{(l.leave_types as unknown as { name: string } | null)?.name ?? "İzin"} · {dt(l.start_date)}{l.end_date !== l.start_date ? `–${dt(l.end_date)}` : ""} · {Number(l.days)} g</span>)}
                  </div>
                </div>
              )}
              <LeavesStep key={pendingLeaves.length} employeeId={id} companyId={s.companyId} types={(leaveTypes ?? []).map((t) => ({ code: t.code, name: t.name }))} initialRows={pendingLeaves} />
              <div className="flex justify-end"><Link href={href(6)} className="h-11 px-5 inline-flex items-center rounded-[10px] bg-brand-700 text-white font-semibold">Çıkış ve özet →</Link></div>
            </>
          )}

          {step === 6 && (
            <>
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold text-brand-800">Çıkış (ayrılan personel için)</h3>
                <Capture employeeId={id} companyId={s.companyId} mode="exit" title="Çıkış evraklarını okut" hint="İstifa dilekçesi, işten ayrılış bildirgesi, ibraname, fesih bildirimi…" />
                <ExitForm employeeId={id} codes={EXIT_CODES} initial={{ termination_date: s2(e.termination_date), termination_code: s2(e.termination_code), termination_reason: s2(e.termination_reason) }} />
              </div>
              <div className="border-t border-line pt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {([
                  ["Kimlik ve iletişim", identityOk, identityOk ? "TC no ve doğum tarihi var" : "TC no / doğum tarihi eksik", 1],
                  ["İşe giriş", hireOk, hireOk ? `Giriş ${dt(e.hire_date)}` : "SGK sicil no eksik", 2],
                  ["Zorunlu evraklar", missing.length === 0, missing.length ? `Eksik: ${missing.slice(0, 3).map((t) => t.name).join(", ")}${missing.length > 3 ? ` +${missing.length - 3}` : ""}` : `${docList.length} belge`, 3],
                  ["Eski bordrolar", (hist ?? []).length > 0, `${(hist ?? []).length} ay`, 4],
                  ["İzinler", (leaves ?? []).length > 0, `${(leaves ?? []).length} kayıt`, 5],
                  ["Ücret kaydı", (contracts ?? 0) > 0, (contracts ?? 0) > 0 ? "var" : "yok (2. adım)", 2],
                ] as Array<[string, boolean, string, number]>).map(([t, ok, d, n]) => (
                  <Link key={t} href={href(n)} className={`rounded-[12px] border p-3 flex gap-3 items-start ${ok ? "border-ok/40 bg-ok-bg" : "border-warn/40 bg-warn-bg"}`}>
                    <span className={`w-7 h-7 rounded-full grid place-items-center font-bold text-sm shrink-0 ${ok ? "bg-ok text-white" : "bg-warn text-white"}`}>{ok ? "✓" : "!"}</span>
                    <span className="flex flex-col"><span className="font-semibold text-sm text-brand-800">{t}</span><span className="text-xs text-muted">{d}</span></span>
                  </Link>
                ))}
              </div>
              <form action={dossDone} className="flex flex-wrap gap-3 items-center justify-end">
                <input type="hidden" name="employeeId" value={id} />
                <input type="hidden" name="next" value={done ? "" : nextEmp?.id ?? ""} />
                {done ? (
                  <><input type="hidden" name="undo" value="1" /><span className="text-sm text-ok font-semibold">Klasör tamamlandı ✓ {dossier?.done_at ? dt(String(dossier.done_at).slice(0, 10)) : ""}</span><button className="h-11 px-4 rounded-xl border border-[#D5DEE8] text-sm font-semibold">Tekrar aç</button></>
                ) : (
                  <button className="h-12 px-6 rounded-xl bg-ok text-white font-bold">{nextEmp ? `Klasör tamam → ${nextEmp.name.split(" ")[0]}` : "Klasör tamam"}</button>
                )}
              </form>
            </>
          )}
        </section>
      </div>
    </>
  );
}
