import "server-only";
/** SGK 4A işe giriş / işten ayrılış web servisi ve vizite (istirahat raporu) web servisi işlemleri */
import { createAdminClient } from "@/lib/supabase/admin";
import type { CikisRow, GirisRow } from "./data";

import { build, call, client, findOp, loadAccount, norm, operations, parseResult, sanitize, type Account } from "./soap";

const creds = (a: Account) => {
  const c: Record<string, unknown> = {};
  for (const k of ["kullaniciAdi", "kullaniciadi"]) c[norm(k)] = a.kullanici_adi;
  c.isyerikodu = a.isyeri_kodu;
  for (const k of ["sistemsifre", "sistemsifresi", "syssifre"]) c[k] = a.sistem ?? "";
  for (const k of ["isyerisifre", "isyerisifresi"]) c[k] = a.isyeri ?? "";
  const d = a.isyeri_sicil.replace(/\D/g, "");
  for (const k of ["isyerisicil", "isyerisicilno", "sicilno"]) c[k] = d;
  return c;
};
const sigortali = (r: GirisRow | CikisRow) => ({ tckimlikno: r.TCKNO, tckno: r.TCKNO, tcno: r.TCKNO, ad: r.AD, adi: r.AD, soyad: r.SOYAD, soyadi: r.SOYAD, meslekkodu: r.MESLEKKODU, csgbiskolu: r.CSGBISKOLU });
const girisCtx = (r: GirisRow) => ({
  ...sigortali(r), giristarihi: r.ISEGIRISTARIHI, isegiristarihi: r.ISEGIRISTARIHI, sigortalituru: r.SIGORTAKOLU, sigortakolu: r.SIGORTAKOLU, istisnakodu: "", gorevkodu: r.GOREVKODU,
  eskihukumlu: r.ESKIHUKUMLU, ozurlu: r.OZURLUKODU, ozurlukodu: r.OZURLUKODU, engelli: r.OZURLUKODU, ogrenimkodu: r.OGRENIMKODU, mezuniyetbolumu: r.MEZUNIYETBOLUMU, mezuniyetyili: r.MEZUNIYETYILI,
  kismisurelicalisiyormu: "H", kismisurelicalismagunsayisi: 0, nakil: "H",
});
const donemCtx = (d: CikisRow["BULUNDUGUMUZDONEM"]) => ({ belgeturu: d.BELGETURU, hakedilenucret: d.HAKEDILENUCRET, primikramiye: d.PRIMIKRAMIYE, eksikgunsayisi: d.EKSIKGUNSAYISI, eksikgunnedeni: d.EKSIKGUNNEDENI });
const cikisCtx = (r: CikisRow) => ({
  ...sigortali(r), istencikistarihi: r.ISTENCIKISTARIHI, cikistarihi: r.ISTENCIKISTARIHI, ayrilistarihi: r.ISTENCIKISTARIHI, istencikisnedeni: String(r.ISTENAYRILISNEDENI).padStart(2, "0"),
  istenayrilisnedeni: String(r.ISTENAYRILISNEDENI).padStart(2, "0"), cikisnedeni: String(r.ISTENAYRILISNEDENI).padStart(2, "0"), nakilgidecegiisyerisicil: "", ucretyuzdeusulu: r.UCRETYUZDEUSULU,
});

async function log(row: Record<string, unknown>) {
  const admin = createAdminClient();
  const { data } = await admin.from("sgk_transactions").insert(row).select("id").single();
  return data?.id as string | undefined;
}
async function savePdf(companyId: string, employeeId: string, kind: string, b64: string) {
  const admin = createAdminClient();
  const path = `${companyId}/employees/${employeeId}/sgk-${kind}-${Date.now()}.pdf`;
  const { error } = await admin.storage.from("documents").upload(path, Buffer.from(b64, "base64"), { contentType: "application/pdf" });
  return error ? null : path;
}

/** Servisleri keşfeder: WSDL'deki metodlar ve giriş alanları (bağlantı testi) */
export async function discover(companyId: string) {
  const a = await loadAccount(companyId);
  if (!a) throw new Error("SGK hesabı tanımlı değil");
  const out: Array<{ service: string; url: string; ok: boolean; error?: string; ops?: Array<{ name: string; input: string }> }> = [];
  for (const [service, url] of [["İşe giriş", a.giris_wsdl], ["İşten ayrılış", a.cikis_wsdl], ["Vizite", a.vizite_url]] as const) {
    try {
      const c = await client(url);
      out.push({ service, url, ok: true, ops: operations(c).map((o) => ({ name: o.name, input: JSON.stringify(o.input).slice(0, 600) })) });
    } catch (e) { out.push({ service, url, ok: false, error: (e as Error).message.slice(0, 300) }); }
  }
  return out;
}

type Result = { employeeId: string; name: string; ok: boolean; reference: string | null; message: string | null; pdfPath: string | null; missing: string[] };

async function sendOne(a: Account, kind: "ise-giris" | "isten-cikis", ctx: Record<string, unknown>, scopes: Record<string, Record<string, unknown> | null>, employeeId: string, name: string, userId: string): Promise<Result> {
  const url = kind === "ise-giris" ? a.giris_wsdl : a.cikis_wsdl;
  const missing: string[] = [];
  try {
    const c = await client(url);
    const op = findOp(c, kind === "ise-giris" ? ["iseGirisKaydet", "sigortaliIseGirisKaydet", "isegiris", "kaydet"] : ["istenCikisKaydet", "sigortaliIstenCikisKaydet", "istencikis", "kaydet"]);
    if (!op) throw new Error(`Serviste kayıt metodu bulunamadı. Metodlar: ${operations(c).map((o) => o.name).join(", ")}`);
    const args = build(op.input, { ...creds(a), ...ctx }, { list: [ctx], scopes }, missing);
    const res = await call(c, op.name, args);
    const r = parseResult(res);
    let pdfPath: string | null = null;
    if (r.ok && r.reference) {
      const pop = findOp(c, kind === "ise-giris" ? ["iseGirisPdfDokum", "pdfDokum", "pdf"] : ["istenCikisPdfDokum", "pdfDokum", "pdf"]);
      if (pop) {
        try {
          const pr = parseResult(await call(c, pop.name, build(pop.input, { ...creds(a), referanskodu: r.reference, referansno: r.reference, tckimlikno: ctx.tckimlikno }, {}, [])));
          if (pr.pdf) pdfPath = await savePdf(a.company_id, employeeId, kind, pr.pdf);
        } catch { /* PDF alınamadı; bildirge kaydı geçerli */ }
      }
    }
    await log({ company_id: a.company_id, account_id: a.id, kind, employee_id: employeeId, environment: a.environment, status: r.ok ? "basarili" : "hata", reference: r.reference, message: r.message ?? (r.ok ? "Kaydedildi" : `SGK hata kodu ${r.code}`), request_summary: { metod: op.name, eslesmeyen: missing.filter((m) => !/sifre/i.test(m)) }, response: sanitize(res) as object, pdf_path: pdfPath, created_by: userId });
    return { employeeId, name, ok: r.ok, reference: r.reference, message: r.message, pdfPath, missing };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await log({ company_id: a.company_id, account_id: a.id, kind, employee_id: employeeId, environment: a.environment, status: "hata", message: msg, request_summary: { url }, created_by: userId });
    return { employeeId, name, ok: false, reference: null, message: msg, pdfPath: null, missing };
  }
}

export async function sendGiris(companyId: string, userId: string, rows: GirisRow[]) {
  const a = await loadAccount(companyId);
  if (!a?.sistem || !a.isyeri) throw new Error("SGK hesabının sistem ve işyeri şifresi girilmemiş (SGK → Ayarlar).");
  const out: Result[] = [];
  for (const r of rows) out.push(await sendOne(a, "ise-giris", girisCtx(r), {}, r.employeeId, r.name, userId));
  return out;
}
export async function sendCikis(companyId: string, userId: string, rows: CikisRow[]) {
  const a = await loadAccount(companyId);
  if (!a?.sistem || !a.isyeri) throw new Error("SGK hesabının sistem ve işyeri şifresi girilmemiş (SGK → Ayarlar).");
  const out: Result[] = [];
  for (const r of rows) out.push(await sendOne(a, "isten-cikis", cikisCtx(r), { bulundugumuzdonem: donemCtx(r.BULUNDUGUMUZDONEM), oncekidonem: r.ONCEKIDONEM ? donemCtx(r.ONCEKIDONEM) : null }, r.employeeId, r.name, userId));
  return out;
}

/* ============================================================ Vizite */
const VIZ = {
  login: ["wsLogin"], byDate: ["raporAramaTarihile", "RaporAramaTarihile"], byTc: ["raporAramaKimlikNo"], approve: ["raporOnay"], notMine: ["personelimDegildir"],
  approved: ["onayliRaporlarTarihile", "OnaylıRaporlarTarihile"], read: ["raporOkunduKapat"], cancel: ["onayIptal", "onaylIptal"],
};
async function viziteSession(a: Account) {
  if (!a.ws) throw new Error("Vizite web servis şifresi girilmemiş (SGK → Ayarlar).");
  const c = await client(a.vizite_url);
  const op = findOp(c, VIZ.login);
  if (!op) throw new Error(`Vizite servisinde wsLogin yok. Metodlar: ${operations(c).map((o) => o.name).join(", ")}`);
  const res = await call(c, op.name, build(op.input, { kullaniciadi: a.kullanici_adi, isyerikodu: a.isyeri_kodu, wssifre: a.ws, sifre: a.ws }, {}, []));
  const r = parseResult(res);
  let token: string | null = null;
  const walk = (o: unknown) => { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (norm(k) === "wstoken" && v) token = String(v); else walk(v); } };
  walk(res);
  if (!token) throw new Error(`Vizite girişi başarısız: ${r.message ?? r.code ?? "token alınamadı"}`);
  return { c, base: { kullaniciadi: a.kullanici_adi, isyerikodu: a.isyeri_kodu, wstoken: token as string } };
}
const rowsOf = (res: unknown): Array<Record<string, unknown>> => {
  const found: Array<Record<string, unknown>> = [];
  const walk = (o: unknown) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === "object") {
      const keys = Object.keys(o).map(norm);
      if (keys.includes("medularaporid") && keys.includes("tckimlikno")) { found.push(o as Record<string, unknown>); return; }
      Object.values(o).forEach(walk);
    }
  };
  walk(res);
  return found.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [norm(k), v])));
};

/** Belirtilen tarihten önceki poliklinik tarihli okunmamış raporları çeker (en çok 100) */
export async function viziteFetch(companyId: string, userId: string | null, date: string) {
  const a = await loadAccount(companyId);
  if (!a) throw new Error("SGK hesabı tanımlı değil");
  const s = await viziteSession(a);
  const op = findOp(s.c, VIZ.byDate)!;
  const res = await call(s.c, op.name, build(op.input, { ...s.base, tarih: date }, { dateFmt: "tr" }, []));
  const r = parseResult(res);
  const rows = rowsOf(res);
  await log({ company_id: companyId, account_id: a.id, kind: "vizite-oku", environment: a.environment, status: r.ok || rows.length ? "basarili" : "hata", message: `${rows.length} rapor${r.message ? ` · ${r.message}` : ""}`, response: sanitize(res) as object, created_by: userId });
  return rows;
}
/** Çalışmadı bildirimi (rapor onayı) */
export async function viziteApprove(companyId: string, userId: string, p: { tc: string; vaka: string; raporId: string; tarih: string; nitelik: "0" | "1" }) {
  const a = await loadAccount(companyId);
  if (!a) throw new Error("SGK hesabı tanımlı değil");
  const s = await viziteSession(a);
  const op = findOp(s.c, VIZ.approve)!;
  const res = await call(s.c, op.name, build(op.input, { ...s.base, tckimlikno: p.tc, vaka: p.vaka, medularaporid: p.raporId, tarih: p.tarih, nitelikdurumu: p.nitelik }, { dateFmt: "tr" }, []));
  const r = parseResult(res);
  await log({ company_id: companyId, account_id: a.id, kind: "vizite-onay", environment: a.environment, status: r.ok ? "basarili" : "hata", reference: p.raporId, message: r.message, response: sanitize(res) as object, created_by: userId });
  return r;
}
export async function viziteMarkRead(companyId: string, raporId: string) {
  const a = await loadAccount(companyId);
  if (!a) return null;
  const s = await viziteSession(a);
  const op = findOp(s.c, VIZ.read);
  if (!op) return null;
  return parseResult(await call(s.c, op.name, build(op.input, { ...s.base, medularaporid: raporId }, {}, [])));
}
