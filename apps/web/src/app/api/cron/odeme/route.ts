import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSupplierNotice } from "@/lib/supplier-notify";
import { money } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

type SupItem = { party_id: string; party: string; kind: string; label: string; due_date: string; amount: number; currency: string; doc: string | null; today: boolean };

/**
 * Ödeme hatırlatmaları (Vercel Cron, her sabah 09:00 TR).
 * Vadeye N gün kala ve vade günü: finans + satın almaya bildirim; istenen kalemlerde tedarikçiye e-posta / WhatsApp.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });
  const admin = createAdminClient();
  const forced = new URL(req.url).searchParams.get("tarih");
  const today = forced && /^\d{4}-\d{2}-\d{2}$/.test(forced) ? forced : new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await admin.rpc("pay_reminders_run", { p_today: today });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const res = data as { notified: number; supplier: SupItem[] };
  const sent: string[] = [];
  for (const it of res.supplier ?? []) {
    const d = it.due_date.split("-").reverse().join(".");
    const text = `${it.today ? "Bugün" : d + " tarihinde"} ${money(it.amount, it.currency)} tutarındaki ${it.label.toLocaleLowerCase("tr")}${it.doc ? ` (${it.doc})` : ""} vadesi ${it.today ? "doluyor" : "geliyor"}. Ödeme takviminizi tedarikçi ekranından görebilirsiniz.`;
    const r = await sendSupplierNotice({ partyId: it.party_id, subject: `Ödeme bilgilendirmesi · ${d}`, text, email: true, whatsapp: true, path: "/tedarikci/odemeler" });
    sent.push(`${it.party}: ${r.via.join("+") || r.errors.join(" | ")}`);
  }
  return NextResponse.json({ today, notified: res.notified, supplier: sent });
}
