import "server-only";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownVkn, rowFromXmlDir, type EinvRow } from "@/lib/einv";

/**
 * eLogo PostBox web servisi istemcisi (SOAP).
 *
 * Kimlik bilgileri Vercel ortam değişkenlerindedir (kodda / veritabanında tutulmaz):
 *   ELOGO_USER, ELOGO_PASS  — eLogo web servis kullanıcısı
 *   ELOGO_URL               — isteğe bağlı servis adresi (varsayılan canlı PostBoxService); ELOGO_TEST=1 → demo
 *
 * Servisin WSDL'i çalışma anında okunur: metot adları, SOAPAction değerleri, parametre adları ve ad alanları
 * WSDL'den çıkarılır. Bilinen akış (eLogo PostBoxService): Login → belge listesi → GetDocumentData (ETTN ile, UBL ZIP) → Logout.
 */

const URL_DEFAULT = process.env.ELOGO_TEST === "1" ? "https://pb-demo.elogo.com.tr/PostBoxService.svc" : "https://pb.elogo.com.tr/PostBoxService.svc";
export const elogoUrl = () => (process.env.ELOGO_URL || URL_DEFAULT).replace(/\?.*$/, "");
export const elogoConfigured = () => !!(process.env.ELOGO_USER && process.env.ELOGO_PASS);

type Param = { name: string; ns: string; typeNs: string | null; isArray: boolean; members?: string[] };
type Wsdl = { tns: string; endpoint: string; actions: Record<string, string>; params: Record<string, Param[]>; ops: string[]; raw: number };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Hazır XML parçası (iç içe veri sözleşmeleri için) */
class Raw { constructor(public xml: string) {} }
const DC_NS = "http://schemas.datacontract.org/2004/07/eFaturaWebService";

/** WSDL (tek dosya) okuma ve çözümleme */
async function loadWsdl(): Promise<Wsdl> {
  let text = "";
  for (const q of ["?singleWsdl", "?wsdl"]) {
    try {
      const r = await fetch(elogoUrl() + q, { signal: AbortSignal.timeout(20000) });
      if (r.ok) { text = await r.text(); if (/definitions/.test(text)) break; }
    } catch { /* sonraki */ }
  }
  if (!/definitions/.test(text)) throw new Error("eLogo servis tanımı (WSDL) okunamadı: adres yanlış ya da servise erişilemiyor.");
  const tns = text.match(/<(?:wsdl:)?definitions[^>]*targetNamespace="([^"]+)"/)?.[1] ?? "http://tempuri.org/";
  // SOAP 1.1 bağlaması (basicHttpBinding) tercih edilir
  const endpoint = text.match(/<soap:address\s+location="([^"]+)"/)?.[1] ?? elogoUrl();
  const actions: Record<string, string> = {};
  const binding = text.match(/<(?:wsdl:)?binding[^>]*>[\s\S]*?<soap:binding[\s\S]*?<\/(?:wsdl:)?binding>/)?.[0] ?? text;
  for (const m of binding.matchAll(/<(?:wsdl:)?operation\s+name="(\w+)"\s*>\s*<soap:operation\s+soapAction="([^"]*)"/g)) actions[m[1]!] = m[2]!;
  // Şemalar: her şemanın ad alanı ve içindeki element / complexType tanımları
  const params: Record<string, Param[]> = {};
  const types: Record<string, { ns: string; members: string[]; isArray: boolean }> = {};
  const schemas = [...text.matchAll(/<(?:xs|xsd):schema([^>]*)>([\s\S]*?)<\/(?:xs|xsd):schema>/g)];
  for (const s of schemas) {
    const ns = s[1]!.match(/targetNamespace="([^"]+)"/)?.[1] ?? "";
    for (const ct of s[2]!.matchAll(/<(?:xs|xsd):complexType\s+name="(\w+)"[^>]*>([\s\S]*?)<\/(?:xs|xsd):complexType>/g)) {
      const members = [...ct[2]!.matchAll(/<(?:xs|xsd):element[^>]*name="(\w+)"/g)].map((m) => m[1]!);
      types[`${ns}#${ct[1]}`] = { ns, members, isArray: /maxOccurs="unbounded"/.test(ct[2]!) && members.length === 1 };
    }
  }
  for (const s of schemas) {
    const ns = s[1]!.match(/targetNamespace="([^"]+)"/)?.[1] ?? "";
    if (ns !== tns) continue;
    for (const el of s[2]!.matchAll(/<(?:xs|xsd):element\s+name="(\w+)"\s*>\s*<(?:xs|xsd):complexType>\s*<(?:xs|xsd):sequence>([\s\S]*?)<\/(?:xs|xsd):sequence>/g)) {
      params[el[1]!] = [...el[2]!.matchAll(/<(?:xs|xsd):element([^>]*)\/?>/g)].map((m) => {
        const a = m[1]!;
        const name = a.match(/name="(\w+)"/)?.[1] ?? "";
        const type = a.match(/type="(?:(\w+):)?(\w+)"/);
        const prefix = type?.[1];
        const typeNs = prefix ? (a.match(new RegExp(`xmlns:${prefix}="([^"]+)"`))?.[1] ?? text.match(new RegExp(`xmlns:${prefix}="([^"]+)"`))?.[1] ?? null) : null;
        const t = typeNs && type ? types[`${typeNs}#${type[2]}`] : undefined;
        return { name, ns, typeNs, isArray: !!t?.isArray, members: t?.members };
      }).filter((p) => p.name);
    }
  }
  return { tns, endpoint, actions, params, ops: Object.keys(actions), raw: text.length };
}

const idx = (order: string[], k: string) => { const i = order.findIndex((o) => o.toLowerCase() === k.toLowerCase()); return i < 0 ? 999 : i; };

/** Değeri XML'e çevir: dizi → <string> öğeleri, nesne → üyeler (tür ad alanında) */
function valueXml(p: Param, v: unknown): string {
  const typeNs = p.typeNs ?? p.ns;
  if (v instanceof Raw) return v.xml;
  if (Array.isArray(v)) return v.map((x) => `<a:string xmlns:a="${p.typeNs ?? "http://schemas.microsoft.com/2003/10/Serialization/Arrays"}">${esc(String(x))}</a:string>`).join("");
  if (v && typeof v === "object") {
    const order = p.members ?? [];
    const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => idx(order, a) - idx(order, b));
    // WCF veri sözleşmesi üye sırasına duyarlıdır: WSDL'deki sıra kullanılır; adlar büyük/küçük harf farkıyla eşleştirilir
    return entries.map(([k, x]) => [order.find((o) => o.toLowerCase() === k.toLowerCase()) ?? k, x] as const).map(([k, x]) => `<b:${k} xmlns:b="${typeNs}">${esc(String(x ?? ""))}</b:${k}>`).join("");
  }
  return esc(String(v ?? ""));
}

async function call(w: Wsdl, op: string, args: Record<string, unknown>): Promise<string> {
  const ps = w.params[op] ?? Object.keys(args).map((name) => ({ name, ns: w.tns, typeNs: null, isArray: false }));
  const inner = ps.filter((p) => args[p.name] !== undefined).map((p) => `<${p.name}>${valueXml(p, args[p.name])}</${p.name}>`).join("");
  const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><${op} xmlns="${w.tns}">${inner}</${op}></s:Body></s:Envelope>`;
  const r = await fetch(w.endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${w.actions[op] ?? `${w.tns.replace(/\/?$/, "/")}IPostBoxService/${op}`}"` },
    body, signal: AbortSignal.timeout(45000),
  });
  const text = await r.text();
  if (!r.ok) {
    const fault = text.match(/<(?:\w+:)?(?:faultstring|Text)[^>]*>([^<]+)</)?.[1];
    throw new Error(`${op}: HTTP ${r.status}${fault ? ` · ${fault}` : ""}`);
  }
  return text;
}

export const tag = (xml: string, name: string) => xml.match(new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`))?.[1] ?? null;
const resultOf = (xml: string) => ({ code: tag(xml, "resultCode"), msg: tag(xml, "resultMsg") });

/** Bağlantı testi: WSDL metotları ve oturum açma */
export async function elogoTest(): Promise<{ ok: boolean; message: string; ops?: string[]; login?: boolean }> {
  if (!elogoConfigured()) return { ok: false, message: "Vercel'de ELOGO_USER ve ELOGO_PASS tanımlı değil." };
  const w = await loadWsdl();
  const login = await elogoLogin(w);
  if (login.session) await call(w, "Logout", { sessionID: login.session }).catch(() => null);
  return { ok: !!login.session, message: login.session ? `Bağlantı kuruldu. Servis metotları: ${w.ops.join(", ")}` : `Oturum açılamadı: ${login.error}`, ops: w.ops, login: !!login.session };
}

async function elogoLogin(w: Wsdl): Promise<{ session: string | null; error: string | null }> {
  const p = w.params.Login?.[0];
  const xml = await call(w, "Login", { [p?.name ?? "login"]: { userName: process.env.ELOGO_USER!, passWord: process.env.ELOGO_PASS! } });
  const session = tag(xml, "sessionID");
  const ok = /<(?:\w+:)?LoginResult>true</i.test(xml);
  return { session: ok && session ? session : null, error: ok ? null : (resultOf(xml).msg ?? "kullanıcı adı / şifre reddedildi") };
}

const DOC_TYPES: Array<{ type: string; label: string }> = [
  { type: "EINVOICE", label: "e-Fatura" },
  { type: "EARCHIVE", label: "e-Arşiv" },
  { type: "DESPATCHADVICE", label: "e-İrsaliye" },
];
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/** Belgenin UBL XML'i (ZIP içinden) */
async function documentXml(w: Wsdl, session: string, uuid: string, type: string): Promise<string[]> {
  const op = w.ops.includes("GetDocumentData") ? "GetDocumentData" : "GetDocument";
  const xml = await call(w, op, { sessionID: session, uuid, paramList: [`DOCUMENTTYPE=${type}`, "DATAFORMAT=UBL", "ISCANCEL=0"] });
  const b64 = [...xml.matchAll(/<(?:\w+:)?(?:Value|binaryData)>([A-Za-z0-9+/=\s]{200,})<\//g)].map((m) => m[1]!).sort((a, b) => b.length - a.length)[0];
  if (!b64) { const r = resultOf(xml); throw new Error(r.msg ?? "belge içeriği boş"); }
  const buf = Buffer.from(b64.replace(/\s/g, ""), "base64");
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buf);
    const out: string[] = [];
    for (const e of Object.values(zip.files)) if (!e.dir && /\.xml$/i.test(e.name)) out.push(await e.async("string"));
    return out;
  }
  return [buf.toString("utf8")];
}

async function flush(supabase: SupabaseClient, rows: EinvRow[]): Promise<number> {
  if (!rows.length) return 0;
  const { data, error } = await supabase.rpc("einv_inbox_add", { p_rows: rows, p_source: "api" });
  if (error) throw new Error(error.message);
  return Number((data as { added: number }).added ?? 0);
}

/**
 * Eşitleme: tarih aralığındaki gelen ve giden belgeleri listeler, kutuda olmayanların UBL'ini indirir, kutuya ekler.
 * Yön (gelen / giden) XML'deki satıcı VKN'sinden belirlenir.
 */
export async function elogoSync(supabase: SupabaseClient, opts: { from: string; to: string; max?: number }): Promise<{ ok: boolean; message: string; log: Record<string, unknown> }> {
  const log: Record<string, unknown> = { from: opts.from, to: opts.to, types: {} as Record<string, unknown> };
  if (!elogoConfigured()) return { ok: false, message: "Vercel'de ELOGO_USER ve ELOGO_PASS tanımlı değil.", log };
  const w = await loadWsdl();
  log.ops = w.ops;
  const listOp = w.ops.find((o) => /^GetDocumentList$/i.test(o)) ?? w.ops.find((o) => /^GetDocumentList/i.test(o)) ?? w.ops.find((o) => /List/i.test(o) && /Document/i.test(o));
  if (!listOp) return { ok: false, message: `Serviste belge listeleme metodu bulunamadı (metotlar: ${w.ops.join(", ")}).`, log };
  const login = await elogoLogin(w);
  if (!login.session) return { ok: false, message: `eLogo oturumu açılamadı: ${login.error}`, log };
  const session = login.session;
  const vkn = await ownVkn(supabase);
  const max = opts.max ?? 80;
  let added = 0, fetched = 0, errors = 0, remaining = 0;
  try {
    // 1) Listeleme: her tür ve yön için ETTN'ler (kutuda olanlar ayıklanır)
    type Bucket = { type: string; optype: string; todo: string[] };
    const buckets: Bucket[] = [];
    const seen = new Set<string>();
    for (const t of DOC_TYPES) {
      const tl: Record<string, unknown> = {};
      (log.types as Record<string, unknown>)[t.type] = tl;
      for (const optype of ["1", "2"]) {
        try {
          const xml = await call(w, listOp, { sessionID: session, paramList: [`DOCUMENTTYPE=${t.type}`, `BEGINDATE=${opts.from}`, `ENDDATE=${opts.to}`, `OPTYPE=${optype}`, "DATEBY=0"] });
          const found = [...new Set((xml.match(UUID_RE) ?? []).map((u) => u.toLowerCase()))].filter((u) => u !== session.toLowerCase() && !seen.has(u));
          found.forEach((u) => seen.add(u));
          tl[`optype${optype}`] = found.length;
          if (!found.length) { const r = resultOf(xml); if (r.msg) tl[`msg${optype}`] = r.msg.slice(0, 200); }
          if (found.length) buckets.push({ type: t.type, optype, todo: found });
        } catch (e) { tl[`err${optype}`] = (e as Error).message.slice(0, 200); }
      }
    }
    const all = buckets.flatMap((b) => b.todo);
    const known = new Set<string>();
    for (let i = 0; i < all.length; i += 200) {
      const { data: have } = await supabase.from("einv_inbox").select("ettn").in("ettn", all.slice(i, i + 200));
      ((have ?? []) as Array<{ ettn: string }>).forEach((h) => known.add(h.ettn.toLowerCase()));
    }
    for (const b of buckets) {
      b.todo = b.todo.filter((u) => !known.has(u));
      const tl = (log.types as Record<string, Record<string, unknown>>)[b.type]!;
      tl[`new${b.optype}`] = b.todo.length;
    }
    // 2) İndirme sınırı türler ve yönler arasında sırayla paylaştırılır (bir tür diğerlerini aç bırakmaz)
    const queue: Array<{ type: string; uuid: string }> = [];
    for (let i = 0; queue.length < max && buckets.some((b) => b.todo.length > i); i++) {
      for (const b of buckets) if (b.todo[i] && queue.length < max) queue.push({ type: b.type, uuid: b.todo[i]! });
    }
    remaining = buckets.reduce((n, b) => n + b.todo.length, 0) - queue.length;
    const rows: EinvRow[] = [];
    for (const q of queue) {
      fetched++;
      try {
        for (const x of await documentXml(w, session, q.uuid, q.type)) {
          const r = rowFromXmlDir(x, vkn, `elogo:${q.type}`);
          if (r) rows.push(r);
        }
      } catch (e) {
        errors++;
        const tl = (log.types as Record<string, Record<string, unknown>>)[q.type]!;
        if (!tl.firstError) tl.firstError = (e as Error).message.slice(0, 200);
      }
      if (rows.length >= 20) added += await flush(supabase, rows.splice(0));
    }
    added += await flush(supabase, rows);
    if (remaining > 0) log.limited = true;
  } finally {
    await call(w, "Logout", { sessionID: session }).catch(() => null);
  }
  Object.assign(log, { added, fetched, errors, remaining });
  // ERP'de aynı numarayla kayıtlı faturalar (Bizim Hesap aktarımı, elle girilen alış) e-belgeye bağlanır
  try { const { data: lk } = await supabase.rpc("einv_inbox_link_existing"); if (lk) log.linked = lk; } catch { /* migration yoksa geç */ }
  await supabase.rpc("einv_elogo_log", { p_log: log });
  return { ok: true, message: `eLogo: ${fetched} belge indirildi, ${added} tanesi kutuya eklendi${errors ? `, ${errors} belge alınamadı` : ""}${remaining ? ` · ${remaining} belge sırada, bir sonraki eşitlemede gelecek` : ""}.`, log };
}

// ---------------------------------------------------------------------
// Gönderim, durum, mükellef sorgusu, PDF, iptal
// ---------------------------------------------------------------------

/** Oturum açıp işi yapar, sonunda kapatır */
export async function withElogo<T>(fn: (w: Wsdl, session: string) => Promise<T>): Promise<T> {
  if (!elogoConfigured()) throw new Error("Vercel'de ELOGO_USER ve ELOGO_PASS tanımlı değil.");
  const w = await loadWsdl();
  const login = await elogoLogin(w);
  if (!login.session) throw new Error(`eLogo oturumu açılamadı: ${login.error}`);
  try { return await fn(w, login.session); } finally { await call(w, "Logout", { sessionID: login.session }).catch(() => null); }
}

const outputs = (xml: string) => Object.fromEntries([...xml.matchAll(/<(?:\w+:)?string>([^<=]+)=([^<]*)<\/(?:\w+:)?string>/g)].map((m) => [m[1]!.trim().toUpperCase(), m[2]!.trim()]));
const resultOk = (xml: string, name: string) => {
  const block = xml.match(new RegExp(`<(?:\\w+:)?${name}Result[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}Result>`))?.[1] ?? xml;
  return { code: Number(tag(block, "resultCode") ?? 0), msg: tag(block, "resultMsg") ?? "" };
};

export type ElogoDocType = "EINVOICE" | "EARCHIVE" | "DESPATCHADVICE";

/** UBL XML → ZIP (tek belge, adı ETTN) → SendDocument */
export async function elogoSend(w: Wsdl, session: string, o: { type: ElogoDocType; ettn: string; xml: string; alias?: string | null; draft?: boolean; xslt?: string | null; numberPrefix?: string | null }): Promise<{ ok: boolean; ref: number | null; message: string }> {
  const zip = new JSZip();
  zip.file(`${o.ettn.toUpperCase()}.xml`, o.xml);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const { createHash } = await import("node:crypto");
  const params = [`DOCUMENTTYPE=${o.type}`, "SIGNED=0"];
  if (o.alias && o.type !== "EARCHIVE") params.push(`ALIAS=${o.alias}`);
  if (o.draft) params.push("DRAFT=1");
  if (o.xslt) params.push(`XSLTUUID=${o.xslt}`);
  if (o.numberPrefix) params.push("SETDOCUMENTNUMBER=1", "DOCUMENTNUMBERTYPE=SERIALCODE", `DOCUMENTNUMBERPREFIX=${o.numberPrefix}`);
  const doc = new Raw(`<b:binaryData xmlns:b="${DC_NS}"><b:Value>${buf.toString("base64")}</b:Value><b:contentType>Base64</b:contentType></b:binaryData>`
    + `<b:currentDate xmlns:b="${DC_NS}">${new Date().toISOString().slice(0, 19)}</b:currentDate>`
    + `<b:fileName xmlns:b="${DC_NS}">${o.ettn.toUpperCase()}.zip</b:fileName>`
    + `<b:hash xmlns:b="${DC_NS}">${createHash("md5").update(buf).digest("hex").toUpperCase()}</b:hash>`);
  const xml = await call(w, "SendDocument", { sessionID: session, paramList: params, document: doc });
  const r = resultOk(xml, "SendDocument");
  const ref = Number(tag(xml, "refId") ?? NaN);
  return { ok: r.code === 1, ref: Number.isFinite(ref) ? ref : null, message: r.msg || (r.code === 1 ? "Başarılı" : `eLogo sonuç kodu ${r.code}`) };
}

export type ElogoStatus = { found: boolean; code: number | null; status: number | null; desc: string; docNo: string | null; isCancel: boolean; envelopeId: string | null; resultMsg: string };

export async function elogoStatus(w: Wsdl, session: string, uuid: string, type: ElogoDocType): Promise<ElogoStatus> {
  const xml = await call(w, "GetDocumentStatus", { sessionID: session, uuid, paramList: [`DOCUMENTTYPE=${type}`] });
  const r = resultOk(xml, "GetDocumentStatus");
  const info = xml.match(/<(?:\w+:)?statusInfo[^>]*>([\s\S]*?)<\/(?:\w+:)?statusInfo>/)?.[1] ?? "";
  const out = outputs(xml);
  const code = tag(info, "code");
  const status = tag(info, "status");
  return {
    found: r.code === 1, code: code != null ? Number(code) : null, status: status != null ? Number(status) : null, desc: tag(info, "description") ?? "",
    docNo: out.ELEMENTID ?? null, isCancel: tag(info, "isCancel") === "true", envelopeId: tag(info, "envelopeId"), resultMsg: r.msg,
  };
}

export type GibUser = { identifier: string; einvoice: boolean; invoiceAliases: string[]; edespatch: boolean; despatchAliases: string[]; title: string | null };

/** GİB mükellef listesinden e-Fatura / e-İrsaliye mükellefiyeti ve posta kutusu etiketleri (en çok 100 VKN) */
export async function elogoCheckUsers(w: Wsdl, session: string, vkns: string[]): Promise<GibUser[]> {
  const list = [...new Set(vkns.map((v) => v.replace(/\D/g, "")).filter((v) => v.length === 10 || v.length === 11))].slice(0, 100);
  if (!list.length) return [];
  const xml = await call(w, "CheckGibUser", { sessionID: session, vknTcknList: list });
  const r = resultOk(xml, "CheckGibUser");
  if (r.code !== 1) throw new Error(`Mükellef sorgusu başarısız: ${r.msg}`);
  const users = [...xml.matchAll(/<(?:\w+:)?GibUserType>([\s\S]*?)<\/(?:\w+:)?GibUserType>/g)].map((m) => m[1]!);
  const aliases = (block: string, list: string) => {
    const b = block.match(new RegExp(`<(?:\\w+:)?${list}>([\\s\\S]*?)</(?:\\w+:)?${list}>`))?.[1] ?? "";
    return [...b.matchAll(/<(?:\w+:)?Alias>([^<]+)</g)].map((x) => x[1]!.trim());
  };
  const found = users.map((u) => {
    const inv = aliases(u, "InvoicePkList");
    const dsp = aliases(u, "DespatchAdvicePkList");
    // kimlik: GibUserType'ın kendi Identifier'ı (alt listelerden önce gelir)
    const ident = u.replace(/<(?:\w+:)?(InvoiceGbList|InvoicePkList|DespatchAdviceGbList|DespatchAdvicePkList)>[\s\S]*?<\/(?:\w+:)?\1>/g, "");
    return { identifier: tag(ident, "Identifier") ?? "", einvoice: inv.length > 0, invoiceAliases: inv, edespatch: dsp.length > 0, despatchAliases: dsp, title: tag(u, "Title") };
  });
  // listede çıkmayan VKN: mükellef değil
  return list.map((v) => found.find((f) => f.identifier === v) ?? { identifier: v, einvoice: false, invoiceAliases: [], edespatch: false, despatchAliases: [], title: null });
}

/** Birden çok etiket varsa varsayılan (defaultpk) tercih edilir */
export const pickAlias = (aliases: string[]) => aliases.find((a) => /defaultpk/i.test(a)) ?? aliases[0] ?? null;

/** Belgenin PDF / HTML görüntüsü */
export async function elogoDocFile(w: Wsdl, session: string, uuid: string, type: ElogoDocType, format: "PDF" | "HTML" | "UBL"): Promise<{ name: string; data: Buffer } | null> {
  const xml = await call(w, "GetDocumentData", { sessionID: session, uuid, paramList: [`DOCUMENTTYPE=${type}`, `DATAFORMAT=${format}`] });
  const r = resultOk(xml, "GetDocumentData");
  if (r.code !== 1) throw new Error(r.msg || "Belge alınamadı");
  const b64 = [...xml.matchAll(/<(?:\w+:)?Value>([A-Za-z0-9+/=\s]{40,})<\//g)].map((m) => m[1]!).sort((a, b) => b.length - a.length)[0];
  if (!b64) return null;
  const buf = Buffer.from(b64.replace(/\s/g, ""), "base64");
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buf);
    const want = format === "PDF" ? /\.pdf$/i : format === "HTML" ? /\.html?$/i : /\.xml$/i;
    const e = Object.values(zip.files).find((f) => !f.dir && want.test(f.name)) ?? Object.values(zip.files).find((f) => !f.dir);
    if (!e) return null;
    return { name: e.name.split("/").pop()!, data: await e.async("nodebuffer") };
  }
  return { name: `${uuid}.${format.toLowerCase()}`, data: buf };
}

/** e-Arşiv faturası iptali (GİB'e raporlanmadan önce / 7 gün içinde) */
export async function elogoCancelEArchive(w: Wsdl, session: string, uuid: string, docNo: string | null): Promise<{ ok: boolean; message: string }> {
  const params = ["DOCUMENTTYPE=CANCELEARCHIVEINVOICE", `UUID=${uuid}`];
  if (docNo) params.push(`ELEMENTID=${docNo}`);
  const xml = await call(w, "SendDocument", { sessionID: session, paramList: params });
  const r = resultOk(xml, "SendDocument");
  return { ok: r.code === 1, message: r.msg || `eLogo sonuç kodu ${r.code}` };
}

/** eLogo'da tanımlı seri önekleri ve son numaraları */
export async function elogoPrefixes(w: Wsdl, session: string): Promise<Array<{ prefix: string; counter: number; type: number }>> {
  const xml = await call(w, "GetPrefixLastNumberList", { sessionID: session, paramList: [] });
  return [...xml.matchAll(/<(?:\w+:)?PrefixLastNumber>([\s\S]*?)<\/(?:\w+:)?PrefixLastNumber>/g)].map((m) => ({
    prefix: tag(m[1]!, "InvoicePrefix") ?? "", counter: Number(tag(m[1]!, "Counter") ?? 0), type: Number(tag(m[1]!, "Type") ?? 0),
  }));
}
