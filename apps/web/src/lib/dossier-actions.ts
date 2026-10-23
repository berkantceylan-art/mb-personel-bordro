"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PDFDocument } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { aiReadDoc, isoDate, kurus, type DossierMode, type IdData, type LeaveData, type Segment, type SgkData, type SlipData } from "@/lib/dossier-ai";

type SB = Awaited<ReturnType<typeof createClient>>;
const HR = ["owner", "accountant", "hr"];
export interface DossFile { path: string; name: string; mime: string; source: "camera" | "scan" | "upload" }
export interface DossDoc { id: string; type: string; name: string; pages: number; date: string | null; expires: string | null; confidence: number | null }
export interface DossResult {
  ok: boolean;
  message: string;
  id?: IdData;
  sgk?: SgkData;
  docs?: DossDoc[];
  slips?: Array<SlipData & { documentId: string | null }>;
  leaves?: Array<LeaveData & { documentId: string | null }>;
}

const touch = (id: string) => { revalidatePath("/ozluk-sihirbazi"); revalidatePath(`/ozluk-sihirbazi/${id}`); revalidatePath(`/personel/${id}`); };

/** Şirkete ait (yoksa oluşturulan) belge türü */
async function ensureType(sb: SB, companyId: string, name: string, category: string): Promise<string> {
  const { data } = await sb.from("document_types").select("id").eq("name", name).or(`company_id.is.null,company_id.eq.${companyId}`).limit(1);
  if (data?.[0]) return data[0].id as string;
  const { data: ins, error } = await sb.from("document_types").insert({ company_id: companyId, name, category, required: false, has_expiry: false, sort_order: 900 }).select("id").single();
  if (error || !ins) throw new Error(error?.message ?? "Belge türü oluşturulamadı");
  return ins.id as string;
}

async function touchDossier(sb: SB, companyId: string, employeeId: string, step?: number) {
  await sb.from("employee_dossier").upsert({ employee_id: employeeId, company_id: companyId, updated_at: new Date().toISOString(), ...(step ? { step } : {}) }, { onConflict: "employee_id" });
}

/** PDF'in belirli sayfalarını ayrı bir PDF olarak çıkarır */
async function slicePdf(bytes: ArrayBuffer, from: number, to: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const idx = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i).filter((i) => i >= 0 && i < src.getPageCount());
  const pages = await out.copyPages(src, idx);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}
/** Görselleri (A4 genişliğine ölçekli) ve PDF'leri sırayla tek PDF'te birleştirir */
async function mergePdf(parts: Array<{ bytes: ArrayBuffer | Uint8Array; mime: string }>): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const p of parts) {
    if (p.mime === "application/pdf") {
      const src = await PDFDocument.load(p.bytes, { ignoreEncryption: true });
      (await out.copyPages(src, src.getPageIndices())).forEach((x) => out.addPage(x));
    } else {
      const img = p.mime === "image/png" ? await out.embedPng(p.bytes) : await out.embedJpg(p.bytes);
      const k = 595 / img.width;
      out.addPage([595, img.height * k]).drawImage(img, { x: 0, y: 0, width: 595, height: img.height * k });
    }
  }
  return out.save();
}
/** Birkaç sayfalık olabilen belge türleri (başlıksız devam sayfası bunlara eklenir) */
const MULTI_PAGE = /sözleşme|sozlesme|kvkk|aydınlatma|rıza|taahhüt|gizlilik|tutanak|yönetmelik|talimat/i;
async function pdfPages(bytes: ArrayBuffer): Promise<number> {
  try { return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount(); } catch { return 1; }
}

/**
 * Yüklenen dosyaları (tarayıcı doğrudan depoya yükler) kaydeder ve yapay zekâyla okur.
 * mode: id (kimlik) · sgk (giriş / çıkış bildirgesi) · docs (belge türünü tanı, çok belgeli PDF'i böl) · payslip (eski bordro) · leave (izin formu)
 */
export async function dossRegister(_: DossResult | null, f: FormData): Promise<DossResult> {
  const s = await getSession();
  if (!HR.includes(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const employeeId = String(f.get("employeeId") ?? "");
  const mode = String(f.get("mode") ?? "docs") as DossierMode | "docs" | "exit";
  let files: DossFile[];
  try { files = JSON.parse(String(f.get("files") ?? "[]")); } catch { return { ok: false, message: "Dosya listesi okunamadı." }; }
  const prefix = `${s.companyId}/employees/${employeeId}/`;
  files = files.filter((x) => typeof x.path === "string" && x.path.startsWith(prefix) && !x.path.includes("..")).slice(0, 12);
  if (!files.length) return { ok: false, message: "Yüklenen dosya yok." };
  const sb = await createClient();

  const { data: typeRows } = await sb.from("document_types").select("id, name, category").or(`company_id.is.null,company_id.eq.${s.companyId}`).order("sort_order");
  const types = (typeRows ?? []) as Array<{ id: string; name: string; category: string }>;
  const typeByName = new Map(types.map((t) => [t.name.toLocaleLowerCase("tr"), t]));
  const classifyList = types.filter((t) => mode === "exit" ? t.category === "cikis" : !["bordro"].includes(t.category)).map((t) => t.name);
  let noKey = false;
  const errors: string[] = [];
  const out: DossResult = { ok: true, message: "" };
  const batch: Array<{ file: DossFile; bytes: ArrayBuffer; mime: string }> = [];

  const insertDoc = async (typeId: string, path: string, name: string, extra: Record<string, unknown>) => {
    const { data, error } = await sb.from("employee_documents").insert({ company_id: s.companyId, employee_id: employeeId, document_type_id: typeId, file_path: path, file_name: name, uploaded_by: s.userId, ...extra }).select("id").single();
    if (error) throw new Error(error.message);
    return data.id as string;
  };

  /**
   * docs / exit: yüklenen sayfalar (fotoğraf ya da PDF) tek PDF'te birleştirilip belge türü tanınır, belgelere bölünür.
   * Böylece 2-3 sayfalık sözleşmenin başlıksız sayfaları ayrı / yanlış belge olarak atanmaz.
   * Az önce (20 dk) kaydedilen belgenin devamı olan sayfalar o belgeye eklenir (seri çekimde parça parça yükleme).
   */
  const classifyBatch = async () => {
    let merged: Uint8Array | ArrayBuffer;
    const single = batch.length === 1 && batch[0]!.mime === "application/pdf";
    try { merged = single ? batch[0]!.bytes : await mergePdf(batch); }
    catch { merged = batch[0]!.bytes; batch.splice(1); }  // birleştirilemeyen görsel: yalnız ilk dosya
    const mergedBuf = merged instanceof Uint8Array ? merged.slice().buffer : merged;
    const mime = batch.length === 1 && batch[0]!.mime !== "application/pdf" ? batch[0]!.mime : "application/pdf";
    const pages = mime === "application/pdf" ? await pdfPages(mergedBuf) : 1;
    const since = new Date(Date.now() - 20 * 60000).toISOString();
    const { data: prevRows } = await sb.from("employee_documents").select("id, file_path, file_name, pages, document_types(name)").eq("employee_id", employeeId).gte("uploaded_at", since).order("uploaded_at", { ascending: false }).limit(1);
    const prev = (prevRows?.[0] ?? null) as { id: string; file_path: string; file_name: string; pages: number | null; document_types: { name: string } | null } | null;
    const prevType = prev?.document_types?.name && MULTI_PAGE.test(prev.document_types.name) ? prev.document_types.name : null;

    const r = await aiReadDoc<{ segments?: Segment[] }>(mergedBuf, mime, "classify", classifyList, prevType);
    if (r.error === "no_key") noKey = true; else if (r.error) errors.push(r.error);
    let segs = (r.data?.segments ?? []).filter((x) => x.from >= 1 && x.to >= x.from && x.to <= pages).sort((a, b) => a.from - b.from);
    // çakışanları ayıkla, hiçbir segmente girmeyen sayfaları "Diğer" olarak ekle (sayfa kaybolmasın)
    const clean: Segment[] = [];
    let next = 1;
    for (const sg of segs) {
      if (sg.to < next) continue;
      if (sg.from > next) clean.push({ from: next, to: sg.from - 1, type: "Diğer" });
      clean.push({ ...sg, from: Math.max(sg.from, next) });
      next = sg.to + 1;
    }
    if (next <= pages) clean.push({ from: next, to: pages, type: "Diğer" });
    segs = clean;
    const known = (t: string) => typeByName.get(String(t ?? "").toLocaleLowerCase("tr"));
    // tanınmayan sayfa, hemen önceki çok sayfalı belgenin devamı sayılır
    const fixed: Segment[] = [];
    for (const sg of segs) {
      const last = fixed[fixed.length - 1];
      if (!known(sg.type) && last && MULTI_PAGE.test(last.type) && last.to + 1 === sg.from) { last.to = sg.to; continue; }
      if (!fixed.length && prevType && sg.from === 1 && (sg.continues_previous || !known(sg.type))) { fixed.push({ ...sg, type: prevType, continues_previous: true }); continue; }
      fixed.push({ ...sg, continues_previous: false });
    }
    const whole = fixed.length === 1 && !fixed[0]!.continues_previous && fixed[0]!.from === 1 && fixed[0]!.to === pages;
    for (const sg of fixed) {
      const k = known(sg.type);
      const n = sg.to - sg.from + 1;
      if (sg.continues_previous && prev) {
        // önceki belgeye ekle
        const { data: pb } = await sb.storage.from("documents").download(prev.file_path);
        if (pb) {
          const pm = prev.file_path.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
          const add = mime === "application/pdf" ? await slicePdf(mergedBuf, sg.from, sg.to) : new Uint8Array(mergedBuf);
          const joined = await mergePdf([{ bytes: await pb.arrayBuffer(), mime: pm }, { bytes: add, mime }]);
          const path = `${prefix}arsiv/${Date.now()}-birlesik.pdf`;
          const up = await sb.storage.from("documents").upload(path, joined, { contentType: "application/pdf" });
          if (!up.error) {
            const total = (prev.pages ?? 1) + n;
            await sb.from("employee_documents").update({ file_path: path, file_name: `${prevType} (${total} sayfa).pdf`, pages: total }).eq("id", prev.id);
            await sb.storage.from("documents").remove([prev.file_path]);
            (out.docs ??= []).push({ id: prev.id, type: `${prevType} (devam sayfası eklendi)`, name: `${total} sayfa`, pages: total, date: null, expires: null, confidence: null });
            continue;
          }
        }
      }
      const typeId = k?.id ?? await ensureType(sb, s.companyId, "Diğer / sınıflandırılmadı", mode === "exit" ? "cikis" : "ozluk");
      let path = batch[0]!.file.path;
      let name = batch.length === 1 ? batch[0]!.file.name : `${k?.name ?? "belge"}.pdf`;
      if (!(whole && batch.length === 1)) {
        const part = mime === "application/pdf" ? (whole ? new Uint8Array(mergedBuf) : await slicePdf(mergedBuf, sg.from, sg.to)) : new Uint8Array(mergedBuf);
        path = `${prefix}arsiv/${Date.now()}-${sg.from}.pdf`;
        name = `${k?.name ?? "belge"}${n > 1 ? ` (${n} sayfa)` : ""}.pdf`;
        const up = await sb.storage.from("documents").upload(path, part, { contentType: "application/pdf" });
        if (up.error) { errors.push(up.error.message); continue; }
      }
      const id = await insertDoc(typeId, path, name, { ai_data: sg, source: batch[0]!.file.source, pages: n, doc_date: isoDate(sg.date), expires_on: isoDate(sg.expires_on) });
      (out.docs ??= []).push({ id, type: k?.name ?? "Diğer / sınıflandırılmadı", name, pages: n, date: isoDate(sg.date), expires: isoDate(sg.expires_on), confidence: typeof sg.confidence === "number" ? sg.confidence : null });
    }
    if (!(whole && batch.length === 1)) await sb.storage.from("documents").remove(batch.map((b) => b.file.path));
  };

  try {
    for (const file of files) {
      const { data: blob, error } = await sb.storage.from("documents").download(file.path);
      if (error || !blob) { errors.push(`${file.name}: okunamadı`); continue; }
      const bytes = await blob.arrayBuffer();
      const mime = file.mime === "application/pdf" || file.path.endsWith(".pdf") ? "application/pdf" : file.mime || "image/jpeg";
      const pages = mime === "application/pdf" ? await pdfPages(bytes) : 1;
      if (bytes.byteLength > 30 * 1024 * 1024) { errors.push(`${file.name}: 30 MB'tan büyük`); continue; }

      if (mode === "id" || mode === "sgk") {
        const r = await aiReadDoc<IdData & SgkData>(bytes, mime, mode);
        if (r.error === "no_key") noKey = true; else if (r.error) errors.push(`${file.name}: ${r.error}`);
        const d = r.data ?? {};
        if (mode === "id") out.id = { ...Object.fromEntries(Object.entries(d).filter(([, v]) => v)), ...Object.fromEntries(Object.entries(out.id ?? {}).filter(([, v]) => v)) } as IdData;
        else out.sgk = { ...(out.sgk ?? {}), ...Object.fromEntries(Object.entries(d).filter(([, v]) => v)) } as SgkData;
        const typeName = mode === "id" ? "Kimlik fotokopisi" : d.kind === "cikis" ? "SGK işten ayrılış bildirgesi" : "SGK işe giriş bildirgesi";
        const typeId = typeByName.get(typeName.toLocaleLowerCase("tr"))?.id ?? await ensureType(sb, s.companyId, typeName, mode === "id" ? "ozluk" : d.kind === "cikis" ? "cikis" : "ozluk");
        const id = await insertDoc(typeId, file.path, file.name, { ai_data: d, source: file.source, pages, doc_date: isoDate(d.hire_date ?? d.termination_date) });
        (out.docs ??= []).push({ id, type: typeName, name: file.name, pages, date: null, expires: null, confidence: null });
        continue;
      }

      if (mode === "payslip") {
        const r = await aiReadDoc<{ slips?: SlipData[] }>(bytes, mime, "payslip");
        if (r.error === "no_key") noKey = true; else if (r.error) errors.push(`${file.name}: ${r.error}`);
        const slips = (r.data?.slips ?? []).filter((x) => /^\d{4}-\d{2}$/.test(x.period ?? ""));
        const typeId = typeByName.get("imzalı bordro")?.id ?? await ensureType(sb, s.companyId, "İmzalı bordro", "bordro");
        if (mime === "application/pdf" && pages > 1 && slips.length > 1 && slips.every((x) => x.page)) {
          // Çok aylık PDF: her ayın sayfası ayrı belge
          for (const sl of slips) {
            const part = await slicePdf(bytes, sl.page!, sl.page!);
            const p = `${prefix}arsiv/bordro-${sl.period}-${Date.now()}.pdf`;
            const up = await sb.storage.from("documents").upload(p, part, { contentType: "application/pdf" });
            if (up.error) { errors.push(up.error.message); continue; }
            const id = await insertDoc(typeId, p, `bordro-${sl.period}.pdf`, { ai_data: sl, source: file.source, pages: 1, period: sl.period });
            (out.slips ??= []).push({ ...sl, documentId: id });
          }
          await sb.storage.from("documents").remove([file.path]);
        } else {
          const id = await insertDoc(typeId, file.path, file.name, { ai_data: { slips }, source: file.source, pages, period: slips[0]?.period ?? null });
          if (slips.length) for (const sl of slips) (out.slips ??= []).push({ ...sl, documentId: id });
          else (out.slips ??= []).push({ documentId: id });
        }
        continue;
      }

      if (mode === "leave") {
        const r = await aiReadDoc<{ leaves?: LeaveData[] }>(bytes, mime, "leave");
        if (r.error === "no_key") noKey = true; else if (r.error) errors.push(`${file.name}: ${r.error}`);
        const typeId = await ensureType(sb, s.companyId, "İzin formu / rapor", "ozluk");
        const id = await insertDoc(typeId, file.path, file.name, { ai_data: r.data, source: file.source, pages });
        const leaves = r.data?.leaves ?? [];
        if (leaves.length) for (const l of leaves) (out.leaves ??= []).push({ ...l, documentId: id });
        else (out.leaves ??= []).push({ documentId: id });
        continue;
      }

      // docs / exit: aynı yüklemedeki tüm sayfalar birlikte değerlendirilir (aşağıda)
      batch.push({ file, bytes, mime });
    }
    if (batch.length) await classifyBatch();
  } catch (e) {
    return { ok: false, message: (e as Error).message.includes("employee_dossier") || (e as Error).message.includes("ai_data") ? "Özlük sihirbazı veritabanı güncellemesi eksik: Supabase'de 20270115000000_dossier.sql dosyasını çalıştırın." : (e as Error).message };
  }
  await touchDossier(sb, s.companyId, employeeId);
  touch(employeeId);
  const n = (out.docs?.length ?? 0) + new Set((out.slips ?? []).map((x) => x.documentId)).size + new Set((out.leaves ?? []).map((x) => x.documentId)).size;
  out.message = [
    `${n} belge kaydedildi.`,
    noKey ? "Yapay zekâ anahtarı tanımlı değil; bilgileri elle girin / türleri seçin." : "",
    errors.length ? `Sorunlar: ${errors.join(" · ")}` : "",
  ].filter(Boolean).join(" ");
  return out;
}

const str = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").trim().slice(0, max) || null;
const date = (f: FormData, k: string) => { const v = String(f.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };

/** 1. adım: kimlik ve iletişim */
export async function dossSaveIdentity(_: DossResult | null, f: FormData): Promise<DossResult> {
  const s = await getSession();
  if (!HR.includes(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const id = String(f.get("employeeId") ?? "");
  const first = str(f, "first_name", 80), last = str(f, "last_name", 80);
  if (!first || !last) return { ok: false, message: "Ad ve soyad zorunlu." };
  const tc = (str(f, "national_id", 11) ?? "").replace(/\D/g, "");
  if (tc && tc.length !== 11) return { ok: false, message: "TC kimlik no 11 hane olmalı." };
  const sb = await createClient();
  const e1 = await sb.from("employees").update({ first_name: first, last_name: last }).eq("id", id);
  if (e1.error) return { ok: false, message: e1.error.message };
  const priv: Record<string, unknown> = {
    employee_id: id, company_id: s.companyId, national_id: tc || null, birth_date: date(f, "birth_date"), birth_place: str(f, "birth_place", 80),
    father_name: str(f, "father_name", 80), mother_name: str(f, "mother_name", 80), gender: str(f, "gender", 10), marital_status: str(f, "marital_status", 20),
    blood_type: str(f, "blood_type", 10), children_count: Number(f.get("children_count") || 0) || null, phone: str(f, "phone", 30), email: str(f, "email", 120),
    address: str(f, "address", 400), emergency_contact_name: str(f, "emergency_contact_name", 120), emergency_contact_phone: str(f, "emergency_contact_phone", 30),
    iban: (str(f, "iban", 40) ?? "").replace(/\s/g, "").toUpperCase() || null, education: str(f, "education", 60), military_status: str(f, "military_status", 60),
    driving_license: str(f, "driving_license", 30), updated_at: new Date().toISOString(),
  };
  const e2 = await sb.from("employee_private").upsert(priv, { onConflict: "employee_id" });
  if (e2.error) return { ok: false, message: e2.error.message };
  await touchDossier(sb, s.companyId, id, 2);
  touch(id);
  return { ok: true, message: "Kimlik ve iletişim bilgileri kaydedildi." };
}

/** 2. adım: işe giriş ve ücret */
export async function dossSaveHire(_: DossResult | null, f: FormData): Promise<DossResult> {
  const s = await getSession();
  if (!HR.includes(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const id = String(f.get("employeeId") ?? "");
  const hire = date(f, "hire_date");
  if (!hire) return { ok: false, message: "İşe giriş tarihi zorunlu." };
  const sb = await createClient();
  const occ = str(f, "sgk_occupation_code", 10);
  const upd: Record<string, unknown> = {
    hire_date: hire, card_no: str(f, "card_no", 20), position_title: str(f, "position_title", 120), department_id: str(f, "department_id", 40),
    contract_type: ["belirsiz", "belirli", "kismi", "cagri"].includes(String(f.get("contract_type"))) ? String(f.get("contract_type")) : "belirsiz",
    sgk_occupation_code: occ && /^\d{4}\.\d{2}$/.test(occ) ? occ : null, is_retired: f.get("is_retired") === "on",
  };
  const e1 = await sb.from("employees").update(upd).eq("id", id);
  if (e1.error) return { ok: false, message: e1.error.message.includes("card_no") ? "Bu PDKS / sicil no başka personelde kayıtlı." : e1.error.message };
  const sgkNo = str(f, "sgk_no", 30);
  if (sgkNo) await sb.from("employee_private").upsert({ employee_id: id, company_id: s.companyId, sgk_no: sgkNo, updated_at: new Date().toISOString() }, { onConflict: "employee_id" });
  // Ücret: kaydı yoksa ilk sözleşme
  const total = String(f.get("total_net") ?? "").trim();
  let contractMsg = "";
  if (total) {
    const { parseTL } = await import("@mb/core");
    let totalNet: number, fixed: number | null = null;
    try { totalNet = parseTL(total); fixed = String(f.get("fixed_official_net") ?? "").trim() ? parseTL(String(f.get("fixed_official_net"))) : null; } catch { return { ok: false, message: "Ücret tutarı okunamadı." }; }
    const ins = f.get("insurance_type") === "FIXED_NET" ? "FIXED_NET" : f.get("insurance_type") === "NONE" ? "NONE" : "MIN_WAGE";
    if (ins === "FIXED_NET" && !fixed) return { ok: false, message: "Belirli resmi net için tutar girin." };
    const { count } = await sb.from("pay_contracts").select("id", { count: "exact", head: true }).eq("employee_id", id);
    if (!count) {
      const { error } = await sb.from("pay_contracts").insert({ company_id: s.companyId, employee_id: id, valid_from: date(f, "contract_from") ?? hire, total_net: totalNet, insurance_type: ins, fixed_official_net: ins === "FIXED_NET" ? fixed : null, bes_rate: 0 });
      if (error) return { ok: false, message: error.message };
      contractMsg = " Ücret kaydı oluşturuldu.";
    } else contractMsg = " (Ücret kaydı zaten var; değişiklik için Zam ekranını kullanın.)";
  }
  await touchDossier(sb, s.companyId, id, 3);
  touch(id);
  return { ok: true, message: `İşe giriş bilgileri kaydedildi.${contractMsg}` };
}

export async function dossSetType(f: FormData): Promise<void> {
  const s = await getSession();
  if (!HR.includes(s.role)) return;
  const sb = await createClient();
  const exp = date(f, "expires_on");
  await sb.from("employee_documents").update({ document_type_id: String(f.get("typeId")), ...(f.has("expires_on") ? { expires_on: exp } : {}) }).eq("id", String(f.get("id")));
  touch(String(f.get("employeeId") ?? ""));
}

export async function dossDeleteDoc(f: FormData): Promise<void> {
  const s = await getSession();
  if (!HR.includes(s.role)) return;
  const sb = await createClient();
  const { data } = await sb.from("employee_documents").select("file_path").eq("id", String(f.get("id"))).maybeSingle();
  const { count } = data ? await sb.from("employee_documents").select("id", { count: "exact", head: true }).eq("file_path", data.file_path) : { count: 0 };
  await sb.from("employee_documents").delete().eq("id", String(f.get("id")));
  if (data?.file_path && (count ?? 0) <= 1) await sb.storage.from("documents").remove([data.file_path]);
  touch(String(f.get("employeeId") ?? ""));
}

/** Belge türü "bu personelde yok / gerekmiyor" */
export async function dossToggleSkip(f: FormData): Promise<void> {
  const s = await getSession();
  if (!HR.includes(s.role)) return;
  const id = String(f.get("employeeId") ?? "");
  const typeId = String(f.get("typeId") ?? "");
  const sb = await createClient();
  const { data } = await sb.from("employee_dossier").select("skipped").eq("employee_id", id).maybeSingle();
  const cur = new Set<string>((data?.skipped as string[] | null) ?? []);
  if (cur.has(typeId)) cur.delete(typeId); else cur.add(typeId);
  await sb.from("employee_dossier").upsert({ employee_id: id, company_id: s.companyId, skipped: [...cur], updated_at: new Date().toISOString() }, { onConflict: "employee_id" });
  touch(id);
}

/** 4. adım: okunan eski bordroları onayla (payroll_history) */
export async function dossSavePayslips(_: DossResult | null, f: FormData): Promise<DossResult> {
  const s = await getSession();
  if (!["owner", "accountant"].includes(s.role)) return { ok: false, message: "Bordro kaydı için sahip / muhasebe yetkisi gerekir." };
  const id = String(f.get("employeeId") ?? "");
  let rows: Array<Record<string, unknown>>;
  try { rows = JSON.parse(String(f.get("rows") ?? "[]")); } catch { return { ok: false, message: "Satırlar okunamadı." }; }
  rows = rows.filter((r) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(r.period ?? "")));
  if (!rows.length) return { ok: false, message: "Dönemi (YYYY-AA) girilmiş satır yok." };
  const sb = await createClient();
  const { error } = await sb.from("payroll_history").upsert(rows.map((r) => ({
    company_id: s.companyId, employee_id: id, period: String(r.period), days: Number(r.days) || null,
    gross: kurus(r.gross), sgk_employee: kurus(r.sgk_employee), unemployment_employee: kurus(r.unemployment_employee), income_tax: kurus(r.income_tax), stamp_tax: kurus(r.stamp_tax),
    net: kurus(r.net), bes: kurus(r.bes), garnishment: kurus(r.garnishment), net_paid: r.net_paid ? kurus(r.net_paid) : null,
    cumulative_tax_base_after: r.cumulative_tax_base ? kurus(r.cumulative_tax_base) : null, document_id: r.documentId || null, data: r,
  })), { onConflict: "employee_id,period" });
  if (error) return { ok: false, message: error.message.includes("payroll_history") ? "Supabase'de 20270115000000_dossier.sql çalıştırılmalı." : error.message };
  await touchDossier(sb, s.companyId, id, 5);
  touch(id);
  revalidatePath("/bordro");
  return { ok: true, message: `${rows.length} aylık eski bordro kaydedildi; bu yılın vergi matrahı artık bunlardan hesaplanır.` };
}

/** 5. adım: okunan izinleri onaylı izin olarak kaydet */
export async function dossSaveLeaves(_: DossResult | null, f: FormData): Promise<DossResult> {
  const s = await getSession();
  if (!HR.includes(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const id = String(f.get("employeeId") ?? "");
  let rows: Array<{ type?: string; start?: string; end?: string; days?: number | string }>;
  try { rows = JSON.parse(String(f.get("rows") ?? "[]")); } catch { return { ok: false, message: "Satırlar okunamadı." }; }
  const sb = await createClient();
  const { data: lt } = await sb.from("leave_types").select("id, code").or(`company_id.is.null,company_id.eq.${s.companyId}`);
  const byCode = new Map((lt ?? []).map((t) => [t.code as string, t.id as string]));
  const ok = rows.filter((r) => isoDate(r.start) && isoDate(r.end ?? r.start) && byCode.has(String(r.type ?? "")));
  if (!ok.length) return { ok: false, message: "Türü ve tarihleri dolu izin satırı yok." };
  const { error } = await sb.from("leave_requests").insert(ok.map((r) => {
    const st = r.start!, en = isoDate(r.end) ?? st;
    const days = Number(String(r.days ?? "").replace(",", ".")) || (Date.parse(en) - Date.parse(st)) / 86_400_000 + 1;
    return { company_id: s.companyId, employee_id: id, leave_type_id: byCode.get(String(r.type))!, start_date: st, end_date: en < st ? st : en, days, status: "approved", decided_by: s.userId, decided_at: new Date().toISOString(), note: "Özlük arşivinden" };
  }));
  if (error) return { ok: false, message: error.message };
  await touchDossier(sb, s.companyId, id, 6);
  touch(id);
  revalidatePath("/izin");
  return { ok: true, message: `${ok.length} izin kaydı eklendi.` };
}

/** 6. adım: çıkış bilgileri (ayrılan personel) */
export async function dossSaveExit(_: DossResult | null, f: FormData): Promise<DossResult> {
  const s = await getSession();
  if (!HR.includes(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const id = String(f.get("employeeId") ?? "");
  const end = date(f, "termination_date");
  const sb = await createClient();
  const { error } = await sb.from("employees").update(end
    ? { termination_date: end, termination_code: str(f, "termination_code", 4), termination_reason: str(f, "termination_reason", 300), status: end <= new Date().toISOString().slice(0, 10) ? "terminated" : "active" }
    : { termination_date: null, termination_code: null, termination_reason: null, status: "active" }).eq("id", id);
  if (error) return { ok: false, message: error.message };
  touch(id);
  return { ok: true, message: end ? "Çıkış bilgileri kaydedildi." : "Personel aktif olarak işaretlendi." };
}

export async function dossDone(f: FormData): Promise<void> {
  const s = await getSession();
  if (!HR.includes(s.role)) return;
  const id = String(f.get("employeeId") ?? "");
  const undo = f.get("undo") === "1";
  const sb = await createClient();
  await sb.from("employee_dossier").upsert({ employee_id: id, company_id: s.companyId, status: undo ? "in_progress" : "done", done_at: undo ? null : new Date().toISOString(), done_by: undo ? null : s.userId, updated_at: new Date().toISOString() }, { onConflict: "employee_id" });
  touch(id);
  const next = String(f.get("next") ?? "");
  redirect(next ? `/ozluk-sihirbazi/${next}` : "/ozluk-sihirbazi?tamam=1");
}

/** Klasörden yeni personel aç (ayrılmış personel dahil) ve sihirbaza geç */
export async function dossCreate(_: DossResult | null, f: FormData): Promise<DossResult> {
  const s = await getSession();
  if (!HR.includes(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const first = str(f, "first_name", 80), last = str(f, "last_name", 80);
  const hire = date(f, "hire_date") ?? new Date().toISOString().slice(0, 10);
  if (!first || !last) return { ok: false, message: "Ad ve soyad girin." };
  const sb = await createClient();
  const { data: br } = await sb.from("branches").select("id").order("created_at").limit(1);
  if (!br?.[0]) return { ok: false, message: "Önce şube tanımlayın (Şirket ayarları)." };
  const left = f.get("left") === "on";
  const { data, error } = await sb.from("employees").insert({ company_id: s.companyId, branch_id: br[0].id, first_name: first, last_name: last, hire_date: hire, status: left ? "terminated" : "active" }).select("id").single();
  if (error || !data) return { ok: false, message: error?.message ?? "Kaydedilemedi." };
  await touchDossier(sb, s.companyId, data.id as string, 1);
  revalidatePath("/ozluk-sihirbazi");
  redirect(`/ozluk-sihirbazi/${data.id}`);
}
