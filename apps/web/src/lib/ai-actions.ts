"use server";
import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

const model = () => process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const json = <T,>(text: string): T => JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as T;

export type AiResult = { ok: boolean; message: string };

/** WhatsApp / e-posta metninden sipariş taslağı: müşteri, hasta, işler, diş, renk, tarih → siparişler kutusuna "yeni" olarak düşer */
export async function aiOrderFromText(_: AiResult | null, f: FormData): Promise<AiResult> {
  const s = await getSession();
  if (!s.logistics) return { ok: false, message: "Yetkiniz yok." };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, message: "Yapay zekâ için Vercel'e ANTHROPIC_API_KEY eklenmeli." };
  const text = String(f.get("text") ?? "").trim().slice(0, 4000);
  if (text.length < 5) return { ok: false, message: "Mesaj metnini yapıştırın." };
  const supabase = await createClient();
  const [{ data: cs }, { data: ps }] = await Promise.all([
    supabase.from("lab_customers").select("id, name").eq("is_active", true).limit(800),
    supabase.from("lab_products").select("name").eq("is_active", true).limit(400),
  ]);
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  try {
    const res = await new Anthropic({ apiKey: key }).messages.create({
      model: model(), max_tokens: 700,
      messages: [{ role: "user", content: `Bir diş protez laboratuvarına gelen sipariş mesajı aşağıda. Bugün ${today}. Yalnız JSON döndür:
{"customer":"aşağıdaki müşteri listesinden en uygun AD (tam yazımıyla) ya da boş","doctor":"doktor adı","patient":"hasta adı / kodu","items":[{"name":"ürün listesinden en uygun ad ya da mesajdaki iş","qty":adet}],"teeth":"FDI diş numaraları boşlukla","shade":"renk ör. A2","due_date":"YYYY-MM-DD ya da boş","pickup":true/false (ölçü/model alınacaksa),"notes":"kısa not"}
Müşteriler: ${(cs ?? []).map((c) => c.name).join(" | ")}
Ürünler: ${(ps ?? []).map((p) => p.name).join(" | ")}
Mesaj:
"""${text}"""` }],
    });
    const out = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const d = json<{ customer?: string; doctor?: string; patient?: string; items?: { name: string; qty: number }[]; teeth?: string; shade?: string; due_date?: string; pickup?: boolean; notes?: string }>(out);
    const cust = (cs ?? []).find((c) => c.name.toLocaleLowerCase("tr") === (d.customer ?? "").toLocaleLowerCase("tr"));
    if (!cust) return { ok: false, message: `Müşteri anlaşılamadı${d.customer ? ` (“${d.customer}”)` : ""}. Siparişi elle girin ya da mesaja müşteri adını ekleyin.` };
    const { data: id, error } = await supabase.rpc("lab_order_save", { p: {
      customer_id: cust.id, source: String(f.get("source") ?? "whatsapp"), doctor_name: d.doctor ?? "", patient: d.patient ?? "", shade: d.shade ?? "", teeth: d.teeth ?? "",
      items: (d.items ?? []).slice(0, 10).map((i) => ({ name: String(i.name).slice(0, 160), qty: Math.max(1, Math.min(99, Number(i.qty) || 1)) })),
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(d.due_date ?? "") && d.due_date! >= today ? d.due_date : null, pickup: !!d.pickup,
      notes: [d.notes, "(yapay zekâ ile mesajdan oluşturuldu — kontrol edin)"].filter(Boolean).join(" "),
    } });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/isler/siparisler");
    redirect(`/isler/siparisler?duzenle=${id}`);
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    return { ok: false, message: `Mesaj okunamadı: ${(e as Error).message.slice(0, 120)}` };
  }
}

/** Yeniden yapım nedenlerinin yapay zekâ özeti ve öneriler */
export async function aiRemakeInsights(): Promise<AiResult> {
  const s = await getSession();
  if ((s.modules.production ?? 0) < 1) return { ok: false, message: "Yetkiniz yok." };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, message: "Yapay zekâ için Vercel'e ANTHROPIC_API_KEY eklenmeli." };
  const supabase = await createClient();
  const { data } = await supabase.from("prd_remakes").select("reason, description, created_at, prd_stations!prd_remakes_station_id_fkey(name), jobs(no, lab_customers(name))").gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString()).limit(300);
  const rows = (data ?? []) as unknown as { reason: string; description: string | null; prd_stations: { name: string } | null; jobs: { no: number; lab_customers: { name: string } | null } | null }[];
  if (rows.length < 3) return { ok: false, message: "Son 90 günde analiz için yeterli yeniden yapım kaydı yok (en az 3)." };
  const lines = rows.map((r) => `- neden: ${r.reason}; istasyon: ${r.prd_stations?.name ?? "-"}; klinik: ${r.jobs?.lab_customers?.name ?? "-"}; not: ${(r.description ?? "").slice(0, 160)}`).join("\n");
  try {
    const res = await new Anthropic({ apiKey: key }).messages.create({
      model: model(), max_tokens: 900,
      messages: [{ role: "user", content: `Bir diş protez laboratuvarının son 90 günlük yeniden yapım (remake) kayıtları aşağıda. Türkçe, kısa ve uygulanabilir bir analiz yaz: 1) en sık 3 kök neden ve oranları, 2) hangi istasyon / klinikte yoğunlaştığı, 3) her biri için somut önlem önerisi (en fazla 6 madde). Başlık kullanma, madde işaretli düz metin yaz.\n${lines}` }],
    });
    return { ok: true, message: res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim() };
  } catch (e) {
    return { ok: false, message: `Analiz yapılamadı: ${(e as Error).message.slice(0, 120)}` };
  }
}
