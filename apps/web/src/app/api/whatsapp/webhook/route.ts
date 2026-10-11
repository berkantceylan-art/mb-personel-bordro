import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { waVerifySignature } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Meta webhook doğrulaması */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (sp.get("hub.mode") === "subscribe" && token && sp.get("hub.verify_token") === token) return new NextResponse(sp.get("hub.challenge") ?? "", { status: 200 });
  return new NextResponse("forbidden", { status: 403 });
}

type Msg = { from: string; id: string; timestamp?: string; type: string; text?: { body: string }; image?: { id: string; mime_type?: string; caption?: string }; document?: { id: string; mime_type?: string; filename?: string; caption?: string }; audio?: { id: string; mime_type?: string }; video?: { id: string; mime_type?: string; caption?: string }; sticker?: { id: string; mime_type?: string }; location?: { latitude: number; longitude: number; name?: string }; button?: { text: string }; interactive?: { button_reply?: { title: string }; list_reply?: { title: string } } };
type Change = { value?: { metadata?: { phone_number_id?: string }; contacts?: { wa_id: string; profile?: { name?: string } }[]; messages?: Msg[]; statuses?: { id: string; status: string; errors?: { title?: string; message?: string }[] }[] } };

/** Gelen mesaj ve iletim durumları (imza doğrulanır, service role ile kaydedilir) */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!waVerifySignature(raw, req.headers.get("x-hub-signature-256"))) return new NextResponse("bad signature", { status: 401 });
  let body: { entry?: { changes?: Change[] }[] };
  try { body = JSON.parse(raw); } catch { return new NextResponse("bad json", { status: 400 }); }
  const admin = createAdminClient();
  for (const e of body.entry ?? []) {
    for (const c of e.changes ?? []) {
      const v = c.value ?? {};
      const phoneId = v.metadata?.phone_number_id ?? "";
      for (const m of v.messages ?? []) {
        const media = m.image ?? m.document ?? m.audio ?? m.video ?? m.sticker;
        const text = m.text?.body ?? m.image?.caption ?? m.document?.caption ?? m.video?.caption ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
          ?? (m.location ? `📍 Konum: https://maps.google.com/?q=${m.location.latitude},${m.location.longitude}` : null);
        const name = v.contacts?.find((x) => x.wa_id === m.from)?.profile?.name ?? null;
        await admin.rpc("wa_inbound", { p: { phone_number_id: phoneId, wa_id: m.from, name, id: m.id, type: m.type, body: text, media_id: media?.id ?? null, media_mime: media?.mime_type ?? null, filename: m.document?.filename ?? null, ts: m.timestamp ?? null } });
      }
      for (const st of v.statuses ?? []) {
        await admin.rpc("wa_status", { p: { id: st.id, status: st.status, error: st.errors?.[0]?.message ?? st.errors?.[0]?.title ?? null } });
      }
    }
  }
  return NextResponse.json({ ok: true });
}
