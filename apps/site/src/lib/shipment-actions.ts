"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { portalContext } from "./portal";
import { createClient } from "./supabase/server";

const s = (f: FormData, k: string, max = 400) => String(f.get(k) ?? "").trim().slice(0, max);
const KNOWN = ["tracking", "courier_date", "rate_limited", "not_allowed", "carrier", "case"];

/** Hekim / klinik / aracı: "kargoya verdim" ya da "kurye ile alın" */
export async function announceShipment(form: FormData) {
  const ctx = await portalContext();
  const acc = ctx?.account;
  if (!acc || acc.status !== "active") redirect("/portal");
  const courier = form.get("mode") === "courier";
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_announce_shipment", {
    p_account: acc.id,
    p_carrier: courier ? "our_courier" : s(form, "carrier", 20),
    p_tracking: courier ? null : s(form, "tracking", 60) || null,
    p_count: Math.min(99, Math.max(1, Number(s(form, "count", 3)) || 1)),
    p_case: s(form, "case", 40) || null,
    p_note: s(form, "note", 1000) || null,
    p_courier_date: courier ? s(form, "date", 10) || null : null,
    p_courier_slot: courier ? s(form, "slot", 12) || "any" : null,
    p_address: courier ? s(form, "address", 400) || null : null,
  });
  revalidatePath("/portal/paketler");
  if (error) {
    const code = KNOWN.find((k) => error.message.includes(k)) ?? "server";
    redirect(`/portal/paketler?hata=${code === "carrier" || code === "case" ? "server" : code}`);
  }
  redirect(`/portal/paketler?tamam=${courier ? "kurye" : "kargo"}`);
}
