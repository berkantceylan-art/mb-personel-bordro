"use server";
import { revalidatePath } from "next/cache";
import { done, fail } from "@/lib/flash";
import { SGK_LINKS } from "@/lib/sgk/codes";
import { encrypt, newToken, tokenHash } from "@/lib/sgk/crypto";
import { cikisRows, cikisXml, companySgk, girisRows, girisXml, type Donem } from "@/lib/sgk/data";
import { discover, sendCikis, sendGiris, viziteApprove, viziteFetch, viziteMarkRead } from "@/lib/sgk/tescil";
import { getSession, todayIso } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const ids = (f: FormData) => f.getAll("id").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
const missing = (m: string) => (/sgk_|csgb_iskolu|sgk_occupation/.test(m) ? "Supabase'de 20261120000000_sgk.sql çalıştırılmalı." : m);
const back = () => { revalidatePath("/sgk"); revalidatePath("/personel"); };

async function ctx(roles = ["owner", "hr", "accountant"]) {
  const s = await getSession();
  if (!roles.includes(s.role)) await fail("Bu işlem için yetkiniz yok.");
  return { s, supabase: await createClient() };
}

/* ------------------------------------------------------------ Ayarlar (yalnız sahip) */
export async function saveAccount(f: FormData) {
  const { s } = await ctx(["owner"]);
  const kul = str(f, "kullanici_adi"), kod = str(f, "isyeri_kodu"), sicil = str(f, "isyeri_sicil").replace(/\D/g, "");
  if (!/^\d{11}$/.test(kul)) await fail("Kullanıcı adı 11 haneli olmalı (TC kimlik no).");
  if (!/^\d{1,4}$/.test(kod)) await fail("İşyeri kodu en fazla 4 haneli sayı olmalı.");
  if (sicil.length !== 26) await fail("İşyeri sicil numarası 26 hane olmalı.");
  const env = str(f, "environment") === "canli" ? "canli" : "test";
  const admin = createAdminClient();
  const row: Record<string, unknown> = { company_id: s.companyId, label: str(f, "label") || "Ana işyeri", isyeri_sicil: sicil, kullanici_adi: kul, isyeri_kodu: kod, environment: env, giris_wsdl: str(f, "giris_wsdl") || null, cikis_wsdl: str(f, "cikis_wsdl") || null, vizite_url: str(f, "vizite_url") || null, updated_by: s.userId, updated_at: new Date().toISOString() };
  try {
    for (const [field, enc, has] of [["sistem_sifre", "sistem_sifre_enc", "has_sistem"], ["isyeri_sifre", "isyeri_sifre_enc", "has_isyeri"], ["ws_sifre", "ws_sifre_enc", "has_ws"]] as const) {
      const v = String(f.get(field) ?? "");
      if (v) { row[enc] = encrypt(v); row[has] = true; }
      if (f.get(`clear_${field}`) === "on") { row[enc] = null; row[has] = false; }
    }
  } catch (e) { await fail((e as Error).message); }
  const { data: existing } = await admin.from("sgk_accounts").select("id").eq("company_id", s.companyId).limit(1).maybeSingle();
  const { error } = existing ? await admin.from("sgk_accounts").update(row).eq("id", existing.id) : await admin.from("sgk_accounts").insert(row);
  if (error) await fail(missing(error.message));
  await admin.from("sgk_transactions").insert({ company_id: s.companyId, kind: "ayar", environment: env, status: "basarili", message: "SGK hesap bilgileri güncellendi (şifreler şifreli saklandı)", created_by: s.userId });
  await admin.from("companies").update({ sgk_registration_no: sicil }).eq("id", s.companyId);
  back();
  await done(`SGK hesabı kaydedildi (${env === "canli" ? "CANLI" : "TEST"} ortam). Şifreler şifrelendi; bir daha gösterilmez. "Bağlantıyı test et" ile deneyin.`);
}

export async function testConnection() {
  const { s } = await ctx(["owner", "hr", "accountant"]);
  let result: Awaited<ReturnType<typeof discover>> = [];
  try { result = await discover(s.companyId); } catch (e) { await fail((e as Error).message); }
  const summary = result.map((r) => `${r.service}: ${r.ok ? `bağlandı (${r.ops?.length ?? 0} metod: ${r.ops?.map((o) => o.name).join(", ")})` : `HATA ${r.error}`}`).join("\n");
  const admin = createAdminClient();
  await admin.from("sgk_accounts").update({ last_test_at: new Date().toISOString(), last_test_result: summary.slice(0, 4000) }).eq("company_id", s.companyId);
  back();
  await done(result.every((r) => r.ok) ? "Üç SGK servisine de bağlanıldı." : "Bazı servislere bağlanılamadı; ayrıntı Ayarlar sekmesinde.");
}

export async function saveCompanySgk(f: FormData) {
  const { s, supabase } = await ctx(["owner", "hr", "accountant"]);
  const kol = Number(str(f, "csgb_iskolu"));
  const { error } = await supabase.from("companies").update({ csgb_iskolu: Number.isFinite(kol) && str(f, "csgb_iskolu") ? kol : null, sgk_araci_no: Number(str(f, "sgk_araci_no")) || 0 }).eq("id", s.companyId);
  if (error) await fail(missing(error.message));
  back();
  await done("İşyeri SGK bilgileri kaydedildi.");
}

export async function saveEmployeeSgk(f: FormData) {
  const { supabase } = await ctx();
  const id = str(f, "employee_id");
  const code = str(f, "sgk_occupation_code");
  if (code && !/^\d{4}\.\d{2}$/.test(code)) await fail("Meslek kodu 9999.99 biçiminde olmalı (ör. 3258.02).");
  const { error } = await supabase.from("employees").update({ sgk_occupation_code: code || null, sgk_duty_code: Number(str(f, "sgk_duty_code")) || 2, sgk_insurance_branch: Number(str(f, "sgk_insurance_branch")) || 0, ex_convict: f.get("ex_convict") === "on" }).eq("id", id);
  if (error) await fail(missing(error.message));
  back();
  await done("Personelin SGK bilgileri kaydedildi.");
}

/* ------------------------------------------------------------ Bildirgeler */
export async function sendGirisAction(f: FormData) {
  const { s, supabase } = await ctx();
  const list = ids(f);
  if (!list.length) await fail("Personel seçin.");
  const rows = await girisRows(supabase, list);
  const bad = rows.filter((r) => r.problems.length);
  if (bad.length) await fail(`Eksik bilgi: ${bad.map((r) => `${r.name} (${r.problems.join(", ")})`).join(" · ")}`);
  let res: Awaited<ReturnType<typeof sendGiris>> = [];
  try { res = await sendGiris(s.companyId, s.userId, rows); } catch (e) { await fail((e as Error).message); }
  back();
  const ok = res.filter((r) => r.ok);
  const err = res.filter((r) => !r.ok);
  if (!ok.length) await fail(`SGK işe giriş gönderilemedi: ${err.map((r) => `${r.name}: ${r.message}`).join(" · ")}`);
  await done(`${ok.length} işe giriş bildirgesi SGK'ya iletildi (${ok.map((r) => `${r.name} ref ${r.reference ?? "—"}`).join(", ")}).${err.length ? ` Hatalı: ${err.map((r) => `${r.name}: ${r.message}`).join(" · ")}` : ""}`);
}

function overridesFrom(f: FormData, list: string[]) {
  const o: Record<string, Partial<Donem> & { prev?: Partial<Donem>; reason?: number }> = {};
  const n = (k: string) => { const v = str(f, k); return v === "" ? undefined : Number(v.replace(",", ".")); };
  for (const id of list) {
    o[id] = { HAKEDILENUCRET: n(`ucret_${id}`), PRIMIKRAMIYE: n(`prim_${id}`), EKSIKGUNSAYISI: n(`eksik_${id}`), EKSIKGUNNEDENI: n(`neden_${id}`), BELGETURU: n(`belge_${id}`), reason: n(`cikis_${id}`) };
    const pu = n(`pucret_${id}`);
    if (pu !== undefined) o[id].prev = { HAKEDILENUCRET: pu, EKSIKGUNSAYISI: n(`peksik_${id}`) ?? 0, EKSIKGUNNEDENI: n(`pneden_${id}`) ?? 0, PRIMIKRAMIYE: 0, BELGETURU: n(`belge_${id}`) ?? 1 };
  }
  return o;
}
export async function sendCikisAction(f: FormData) {
  const { s, supabase } = await ctx();
  const list = ids(f);
  if (!list.length) await fail("Personel seçin.");
  const rows = await cikisRows(supabase, list, overridesFrom(f, list));
  const bad = rows.filter((r) => r.problems.length);
  if (bad.length) await fail(`Eksik bilgi: ${bad.map((r) => `${r.name} (${r.problems.join(", ")})`).join(" · ")}`);
  let res: Awaited<ReturnType<typeof sendCikis>> = [];
  try { res = await sendCikis(s.companyId, s.userId, rows); } catch (e) { await fail((e as Error).message); }
  back();
  const ok = res.filter((r) => r.ok), err = res.filter((r) => !r.ok);
  if (!ok.length) await fail(`SGK işten ayrılış gönderilemedi: ${err.map((r) => `${r.name}: ${r.message}`).join(" · ")}`);
  await done(`${ok.length} işten ayrılış bildirgesi SGK'ya iletildi.${err.length ? ` Hatalı: ${err.map((r) => `${r.name}: ${r.message}`).join(" · ")}` : ""}`);
}

/** Bildirgeyi SGK ekranından elle verdiyseniz kaydı işler */
export async function markManual(f: FormData) {
  const { s, supabase } = await ctx();
  const kind = str(f, "kind") === "isten-cikis" ? "isten-cikis" : "ise-giris";
  const list = ids(f);
  if (!list.length) await fail("Personel seçin.");
  const { error } = await supabase.from("sgk_transactions").insert(list.map((employee_id) => ({ company_id: s.companyId, kind, employee_id, status: "basarili", reference: str(f, "reference") || null, message: "SGK ekranından elle bildirildi", created_by: s.userId })));
  if (error) await fail(missing(error.message));
  back();
  await done(`${list.length} kişi için bildirge yapıldı olarak işaretlendi.`);
}

/** Toplu XML'i robot görevi olarak kuyruğa ekler (eklenti SGK toplu giriş sayfasında dosyayı yükler) */
export async function robotXmlJob(f: FormData) {
  const { s, supabase } = await ctx();
  const kind = str(f, "kind") === "toplu-cikis" ? "toplu-cikis" : "toplu-giris";
  const list = ids(f);
  if (!list.length) await fail("Personel seçin.");
  const comp = await companySgk(supabase);
  if (!comp?.sgk_registration_no) await fail("İşyeri sicil numarası girilmemiş.");
  const rows = kind === "toplu-giris" ? await girisRows(supabase, list) : await cikisRows(supabase, list, overridesFrom(f, list));
  const bad = rows.filter((r) => r.problems.length);
  if (bad.length) await fail(`Eksik bilgi: ${bad.map((r) => `${r.name} (${r.problems.join(", ")})`).join(" · ")}`);
  const xml = kind === "toplu-giris" ? girisXml(comp!, rows as Awaited<ReturnType<typeof girisRows>>) : cikisXml(comp!, rows as Awaited<ReturnType<typeof cikisRows>>);
  const { data: acc } = await supabase.from("sgk_accounts").select("id").limit(1).maybeSingle();
  const { error } = await supabase.from("sgk_robot_jobs").insert({ company_id: s.companyId, account_id: acc?.id ?? null, kind, title: `${kind === "toplu-giris" ? "Toplu işe giriş" : "Toplu işten ayrılış"} · ${rows.map((r) => r.name).join(", ").slice(0, 120)}`, target_url: SGK_LINKS.topluGiris, payload: { xml, fileName: `${kind}-${todayIso()}.xml`, people: rows.map((r) => r.name) }, employee_ids: list });
  if (error) await fail(missing(error.message));
  back();
  await done("Robot görevi oluşturuldu. Bilgisayarınızdaki SGK Robotu eklentisini açıp görevi başlatın.");
}

export async function robotIncidentJob(f: FormData) {
  const { s, supabase } = await ctx(["owner", "hr", "accountant", "safety"]);
  const { data: x } = await supabase.from("safety_incidents").select("*").eq("id", str(f, "id")).single();
  if (!x) await fail("Kayıt bulunamadı.");
  const [{ data: e }, { data: p }] = await Promise.all([
    x!.employee_id ? supabase.from("employees").select("first_name, last_name, position_title, hire_date").eq("id", x!.employee_id).single() : Promise.resolve({ data: null }),
    x!.employee_id ? supabase.from("employee_private").select("national_id").eq("employee_id", x!.employee_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const at = new Date(x!.occurred_at);
  const fields = [
    ["T.C. Kimlik No", p?.national_id ?? ""], ["Adı", e?.first_name ?? ""], ["Soyadı", e?.last_name ?? ""], ["Kaza tarihi", at.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })],
    ["Kaza saati", at.toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" })], ["Kaza yeri", x!.location ?? ""], ["Kazanın oluş şekli", x!.description],
    ["Yaralanan uzuv", x!.body_part ?? ""], ["Yaralanma türü", x!.injury_type ?? x!.injury ?? ""], ["Tanıklar", x!.witnesses ?? ""], ["Sevk edildiği sağlık kuruluşu", x!.hospital ?? ""],
    ["İşe giriş tarihi", e?.hire_date ? e.hire_date.split("-").reverse().join(".") : ""], ["Görevi", e?.position_title ?? ""],
  ].map(([label, value]) => ({ label, value }));
  const { error } = await supabase.from("sgk_robot_jobs").insert({ company_id: s.companyId, kind: "is-kazasi", title: `İş kazası bildirimi · ${e ? `${e.first_name} ${e.last_name}` : ""} · ${at.toLocaleDateString("tr-TR")}`, target_url: SGK_LINKS.isKazasi, payload: { fields }, employee_ids: x!.employee_id ? [x!.employee_id] : [], related_id: x!.id });
  if (error) await fail(missing(error.message));
  revalidatePath("/sgk");
  revalidatePath("/isg/kaza");
  await done("İş kazası bildirimi robot görevi oluşturuldu. SGK Robotu eklentisinden başlatın; formu doldurur, güvenlik kodu ve gönder size kalır.");
}

export async function robotLoginJob(f: FormData) {
  const { s, supabase } = await ctx();
  const target = str(f, "target");
  const url = (SGK_LINKS as Record<string, string>)[target] ?? SGK_LINKS.isveren;
  const { error } = await supabase.from("sgk_robot_jobs").insert({ company_id: s.companyId, kind: "giris-yap", title: `SGK'ya giriş: ${str(f, "label") || target}`, target_url: url, payload: {} });
  if (error) await fail(missing(error.message));
  back();
  await done("Görev oluşturuldu; eklentiden başlatın.");
}
export async function cancelJob(f: FormData) {
  const { supabase } = await ctx();
  await supabase.from("sgk_robot_jobs").update({ status: "iptal", done_at: new Date().toISOString() }).eq("id", str(f, "id")).in("status", ["bekliyor", "calisiyor"]);
  back();
  await done("Görev iptal edildi.");
}

export async function createRobotToken(f: FormData) {
  const { s } = await ctx(["owner"]);
  const t = newToken();
  const admin = createAdminClient();
  const { error } = await admin.from("sgk_robot_tokens").insert({ company_id: s.companyId, user_id: s.userId, label: str(f, "label") || "Bilgisayarım", token_hash: tokenHash(t) });
  if (error) await fail(missing(error.message));
  back();
  await done(`Robot anahtarı (yalnız bir kez gösterilir, eklentiye yapıştırın): ${t}`);
}
export async function revokeRobotToken(f: FormData) {
  const { s } = await ctx(["owner"]);
  const admin = createAdminClient();
  await admin.from("sgk_robot_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", str(f, "id")).eq("company_id", s.companyId);
  back();
  await done("Anahtar iptal edildi; o bilgisayardaki eklenti artık çalışmaz.");
}

/* ------------------------------------------------------------ Vizite */
export async function viziteFetchAction(f: FormData) {
  const { s, supabase } = await ctx();
  const d = str(f, "date") || todayIso();
  let rows: Array<Record<string, unknown>> = [];
  try { rows = await viziteFetch(s.companyId, s.userId, d.split("-").reverse().join(".")); } catch (e) { await fail((e as Error).message); }
  const n = await storeReports(supabase, s.companyId, rows);
  back();
  await done(rows.length ? `${rows.length} rapor alındı, ${n} yeni.` : "Okunmamış rapor yok.");
}

const trDate = (v: unknown) => { const s = String(v ?? ""); const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function storeReports(sb: any, companyId: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return 0;
  const tcs = rows.map((r) => String(r.tckimlikno ?? ""));
  const { data: privs } = await sb.from("employee_private").select("employee_id, national_id").in("national_id", tcs);
  const emp = new Map(((privs ?? []) as Array<{ employee_id: string; national_id: string }>).map((p) => [p.national_id, p.employee_id]));
  const ins = rows.map((r) => ({
    company_id: companyId, employee_id: emp.get(String(r.tckimlikno)) ?? null, tc: String(r.tckimlikno), ad_soyad: String(r.sigortaliadsoyad ?? `${r.ad ?? ""} ${r.soyad ?? ""}`).trim(),
    medula_rapor_id: String(r.medularaporid), rapor_takip_no: r.raportakipno ? String(r.raportakipno) : null, vaka: r.vaka ? String(r.vaka) : null, vaka_adi: r.vakaadi ? String(r.vakaadi) : null,
    poliklinik_tar: trDate(r.polikliniktar), baslangic: trDate(r.abastar ?? r.yatrapbastar), bitis: trDate(r.abittar ?? r.yatrapbittar ?? r.raporbittar), ise_baslama: trDate(r.isbaskonttar), durum: r.rapordurumu ? String(r.rapordurumu) : null, tesis: r.tesisadi ? String(r.tesisadi) : null, raw: r,
  }));
  const { data } = await sb.from("sgk_reports").upsert(ins, { onConflict: "company_id,medula_rapor_id", ignoreDuplicates: true }).select("id");
  return (data ?? []).length;
}

export async function viziteApproveAction(f: FormData) {
  const { s, supabase } = await ctx();
  const { data: r } = await supabase.from("sgk_reports").select("*").eq("id", str(f, "id")).single();
  if (!r) await fail("Rapor bulunamadı.");
  const nitelik = str(f, "nitelik") === "1" ? "1" : "0";
  let res: Awaited<ReturnType<typeof viziteApprove>> | null = null;
  try { res = await viziteApprove(s.companyId, s.userId, { tc: r!.tc, vaka: r!.vaka ?? "", raporId: r!.medula_rapor_id, tarih: (r!.ise_baslama ?? r!.bitis ?? todayIso()).split("-").reverse().join("."), nitelik }); } catch (e) { await fail((e as Error).message); }
  if (!res!.ok) await fail(`SGK onay hatası: ${res!.message ?? res!.code}`);
  // İzin kaydı: rapor günleri istirahat izni olarak işlenir (puantaj ve bordro)
  let leaveId: string | null = null;
  if (r!.employee_id && r!.baslangic && r!.bitis) {
    const { data: t } = await supabase.from("leave_types").select("id").is("company_id", null).eq("code", "RAPOR").single();
    const { data: clash } = await supabase.from("leave_requests").select("id").eq("employee_id", r!.employee_id).in("status", ["pending", "approved"]).lte("start_date", r!.bitis).gte("end_date", r!.baslangic).limit(1);
    if (!clash?.length && t) {
      const days = Math.round((Date.parse(r!.bitis) - Date.parse(r!.baslangic)) / 86_400_000) + 1;
      const { data: l } = await supabase.from("leave_requests").insert({ company_id: s.companyId, employee_id: r!.employee_id, leave_type_id: t.id, start_date: r!.baslangic, end_date: r!.bitis, days, status: "approved", decided_by: s.userId, decided_at: new Date().toISOString(), note: `SGK vizite raporu ${r!.medula_rapor_id}${r!.vaka_adi ? ` · ${r!.vaka_adi}` : ""}` }).select("id").single();
      leaveId = l?.id ?? null;
    } else leaveId = clash?.[0]?.id ?? null;
  }
  await supabase.from("sgk_reports").update({ onay_at: new Date().toISOString(), onay_by: s.userId, nitelik, leave_request_id: leaveId }).eq("id", r!.id);
  try { await viziteMarkRead(s.companyId, r!.medula_rapor_id); await supabase.from("sgk_reports").update({ okundu_at: new Date().toISOString() }).eq("id", r!.id); } catch { /* sonraki okumada tekrar denenir */ }
  back();
  revalidatePath("/puantaj");
  await done(`Çalışmadı bildirimi SGK'ya iletildi${leaveId ? "; rapor izin kaydına işlendi" : ""}.`);
}

