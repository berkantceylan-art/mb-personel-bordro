import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { toolsFor, type Ctx } from "@/lib/assistant/tools";
import { getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ROLE: Record<string, string> = { owner: "şirket sahibi", accountant: "muhasebe", hr: "insan kaynakları", branch_manager: "bölüm şefi", safety: "İSG uzmanı", employee: "personel" };
type Msg = { role: "user" | "assistant"; content: string };

/** İK asistanı: soruyu Claude'a araçlarla birlikte gönderir; araçlar kullanıcının kendi yetkisiyle (RLS) çalışır */
export async function POST(req: Request) {
  const s = await getSession();
  const supabase = await createClient();
  const body = (await req.json().catch(() => ({}))) as { messages?: Msg[] };
  const history = (body.messages ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()).slice(-10).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  const question = history.at(-1);
  if (!question || question.role !== "user") return NextResponse.json({ error: "Soru boş" }, { status: 400 });

  const { data: comp } = await supabase.from("companies").select("assistant_enabled, assistant_daily_limit").eq("id", s.companyId).maybeSingle();
  if (!comp?.assistant_enabled) return NextResponse.json({ error: "İK asistanı şirketiniz için henüz açılmadı. Şirket sahibi Yönetim → İK asistanı bölümünden açabilir." }, { status: 403 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Asistan yapılandırılmamış (ANTHROPIC_API_KEY sunucuda tanımlı değil)." }, { status: 501 });
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await supabase.from("assistant_logs").select("id", { count: "exact", head: true }).eq("user_id", s.userId).gte("created_at", since);
  if ((count ?? 0) >= (comp.assistant_daily_limit ?? 40)) return NextResponse.json({ error: "Günlük soru sınırına ulaştınız; yarın tekrar deneyin." }, { status: 429 });

  const { data: me } = await supabase.from("employees").select("id, first_name, last_name").eq("user_id", s.userId).maybeSingle();
  const today = todayIso();
  const ctx: Ctx = { sb: supabase, userId: s.userId, companyId: s.companyId, role: s.role, today, selfId: me?.id ?? null, selfName: me ? `${me.first_name} ${me.last_name}` : null };
  const tools = toolsFor(s.role, !!me);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const system = `Sen ${s.companyName} şirketinin İK asistanısın. Kullanıcı: ${ctx.selfName ?? "adı kayıtlı değil"} (${ROLE[s.role] ?? s.role}). Bugün ${today.split("-").reverse().join(".")}.
Kurallar:
- Her zaman Türkçe, kısa ve net yanıt ver. Gerekirse kısa madde işaretleri kullan. Tutarları ₺ ile, tarihleri GG.AA.YYYY biçiminde yaz.
- Kişiye, şirkete ait sayı ve bilgileri YALNIZ araç sonuçlarından ver. Asla tahmin etme, uydurma. Araç sonucu boşsa veya yetki yoksa bunu açıkça söyle.
- "Geçen ay", "bu ay" gibi ifadeleri bugünün tarihine göre dönem (YYYY-AA) olarak çevir.
- Bordro kesinti sorularında her kesinti kalemini tutarıyla ve tek cümlelik nedeniyle açıkla (SGK işçi payı, işsizlik sigortası, gelir vergisi, damga vergisi, istisnalar, BES, icra, avans).
- Yalnız bilgi verirsin; kayıt değiştiremez, izin veya avans talebi oluşturamazsın. Bunun için ilgili sayfayı söyle: izin /benim/izin, avans /benim/avans, puantaj /benim/puantaj, bordro /benim/bordro; yöneticiler için /yillik-izin, /puantaj, /fazla-mesai.
- Kullanıcının yetkisi dışındaki kişilerin bilgilerini isteme veya tahmin etme. Personel yalnız kendi bilgisini görebilir.
- İK, hukuk veya vergi konusunda kesin görüş gerektiren durumlarda İK birimine yönlendir.`;

  const client = new Anthropic({ apiKey: key });
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  const used: string[] = [];
  let inTok = 0, outTok = 0;
  try {
    for (let step = 0; step < 6; step++) {
      const res = await client.messages.create({ model, max_tokens: 1200, system, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })), messages });
      inTok += res.usage.input_tokens; outTok += res.usage.output_tokens;
      if (res.stop_reason !== "tool_use") {
        const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
        await supabase.from("assistant_logs").insert({ company_id: s.companyId, user_id: s.userId, question: question.content.slice(0, 500), tools: used, input_tokens: inTok, output_tokens: outTok });
        return NextResponse.json({ answer: text || "Yanıt üretilemedi.", tools: used });
      }
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const b of res.content) {
        if (b.type !== "tool_use") continue;
        used.push(b.name);
        const tool = byName.get(b.name);
        let out: unknown;
        try { out = tool ? await tool.run(ctx, (b.input ?? {}) as Record<string, string>) : { hata: "Bu araca yetkiniz yok." }; } catch (e) { out = { hata: `Veri okunamadı: ${(e as Error).message.slice(0, 200)}` }; }
        results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out).slice(0, 20000) });
      }
      messages.push({ role: "user", content: results });
    }
    return NextResponse.json({ answer: "Soru çok adım gerektirdi; daha kısa ve tek konulu sorar mısınız?", tools: used });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await supabase.from("assistant_logs").insert({ company_id: s.companyId, user_id: s.userId, question: question.content.slice(0, 500), tools: used, error: msg });
    return NextResponse.json({ error: "Asistan şu an yanıt veremiyor. Biraz sonra tekrar deneyin." }, { status: 502 });
  }
}
