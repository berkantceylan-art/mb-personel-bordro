import Link from "next/link";
import { savePortalClient, togglePortalClient } from "@/lib/portal-team-actions";
import { TEAM_UI } from "@/lib/portal-team-ui";
import { portalContext, portalLocale } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Clients" };

type Client = { id: string; name: string; country: string | null; city: string | null; phone: string | null; note: string | null; is_active: boolean };

/** Aracı kuruluş / klinik: vaka gönderdiği hekim ve klinikler */
export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ duzenle?: string; hata?: string }> }) {
  const ctx = await portalContext();
  const acc = ctx!.account!;
  const locale = await portalLocale(acc);
  const tu = TEAM_UI[locale];
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, { data: cs }] = await Promise.all([
    supabase.from("portal_clients").select("id, name, country, city, phone, note, is_active").eq("account_id", acc.id).order("name"),
    supabase.from("portal_cases").select("client_id, status").eq("account_id", acc.id).not("client_id", "is", null),
  ]);
  const clients = (data ?? []) as Client[];
  const total = new Map<string, number>();
  const open = new Map<string, number>();
  for (const c of cs ?? []) {
    total.set(c.client_id as string, (total.get(c.client_id as string) ?? 0) + 1);
    if (!["delivered", "cancelled"].includes(c.status as string)) open.set(c.client_id as string, (open.get(c.client_id as string) ?? 0) + 1);
  }
  const edit = sp.duzenle ? clients.find((c) => c.id === sp.duzenle) : undefined;

  return (
    <>
      <h1 className="display text-3xl font-semibold text-navy">{tu.clientsTitle}</h1>
      <p className="mt-1 max-w-2xl text-slate">{tu.clientsLead}</p>
      {(sp.hata || error) && <p className="mt-4 rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad">{tu.errors.server}</p>}
      <form key={edit?.id ?? "new"} action={savePortalClient} className="mt-6 grid gap-3 rounded-3xl bg-white p-6 sm:grid-cols-5">
        {edit && <input type="hidden" name="id" value={edit.id} />}
        <input name="name" required defaultValue={edit?.name ?? ""} placeholder={tu.clientName} className="field sm:col-span-2" />
        <input name="country" defaultValue={edit?.country ?? ""} placeholder={tu.country} className="field" />
        <input name="city" defaultValue={edit?.city ?? ""} placeholder={tu.city} className="field" />
        <input name="phone" defaultValue={edit?.phone ?? ""} placeholder={tu.phone} className="field" />
        <input name="note" defaultValue={edit?.note ?? ""} placeholder={tu.note} className="field sm:col-span-4" />
        <button className="rounded-full bg-navy px-5 py-3 font-semibold text-white hover:bg-blue">{tu.add}</button>
      </form>
      <ul className="mt-6 grid gap-2">
        {clients.map((c) => (
          <li key={c.id} className={`flex flex-wrap items-center gap-3 rounded-2xl bg-white px-5 py-4 ${c.is_active ? "" : "opacity-60"}`}>
            <Link href={`/portal/musteriler?duzenle=${c.id}`} className="font-semibold text-navy hover:underline">{c.name}</Link>
            <span className="text-sm text-slate">{[c.city, c.country].filter(Boolean).join(", ")}</span>
            <Link href={`/portal?musteri=${c.id}`} className="text-sm font-semibold text-smile-ink">{tu.cases}: {total.get(c.id) ?? 0}{open.get(c.id) ? ` (${open.get(c.id)} ⏳)` : ""}</Link>
            <form action={togglePortalClient} className="ml-auto">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="on" value={c.is_active ? "0" : "1"} />
              <button className="text-xs font-semibold text-slate">{c.is_active ? "⏸" : "▶"}</button>
            </form>
          </li>
        ))}
        {clients.length === 0 && <li className="text-slate">{tu.noClients}</li>}
      </ul>
    </>
  );
}
